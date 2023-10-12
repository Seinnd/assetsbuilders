import type { BatchToPusherRoomMessage } from "@workadventure/messages";
import Debug from "debug";
import type { ClientReadableStream } from "@grpc/grpc-js";
import * as Sentry from "@sentry/node";
import { WAMFileFormat, WAMSettingsUtils } from "@workadventure/map-editor";
import { apiClientRepository } from "../services/ApiClientRepository";
import { PositionDispatcher } from "./PositionDispatcher";
import type { ViewportInterface } from "./websocket/ViewportMessage";
import type { Zone, ZoneEventListener } from "./Zone";
import { CustomJsonReplacerInterface } from "./CustomJsonReplacerInterface";
import { Socket } from "socket.io";
import { socketManager } from "../services/SocketManager";
import { SocketData } from "./websocket/SocketData";

const debug = Debug("room");

export class PusherRoom implements CustomJsonReplacerInterface {
    private readonly positionNotifier: PositionDispatcher;
    private versionNumber = 1;
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    public mucRooms: Array<any> = [];

    private backConnection!: ClientReadableStream<BatchToPusherRoomMessage>;
    private isClosing = false;
    private listeners: Set<Socket> = new Set<Socket>();

    private _wamSettings: WAMFileFormat["settings"] = {};

    constructor(public readonly roomUrl: string, private socketListener: ZoneEventListener) {
        // A zone is 10 sprites wide.
        this.positionNotifier = new PositionDispatcher(this.roomUrl, 320, 320, this.socketListener);

        // By default, create a MUC room whose name is the name of the room.
        this.mucRooms = [
            {
                name: "Connected users",
                uri: roomUrl,
            },
        ];
    }

    public setViewport(socket: Socket, socketData: SocketData): void {
        this.positionNotifier.setViewport(socket, socketData);
    }

    public join(socket: Socket, socketData: SocketData): void {
        this.listeners.add(socket);

        if (!this.mucRooms) {
            return;
        }

        socketData.pusherRoom = this;
    }

    public leave(socket: Socket, socketData: SocketData): void {
        this.positionNotifier.removeViewport(socket, socketData);
        this.listeners.delete(socket);
        socketData.pusherRoom = undefined;
    }

    public isEmpty(): boolean {
        return this.positionNotifier.isEmpty();
    }

    public needsUpdate(versionNumber: number): boolean {
        if (this.versionNumber < versionNumber) {
            this.versionNumber = versionNumber;
            return true;
        } else {
            return false;
        }
    }

    /**
     * Creates a connection to the back server to track global messages relative to this room (like variable changes).
     */
    public async init(): Promise<void> {
        debug("Opening connection to room %s on back server", this.roomUrl);
        const apiClient = await apiClientRepository.getClient(this.roomUrl);
        this.backConnection = apiClient.listenRoom({
            roomId: this.roomUrl,
        });
        this.backConnection.on("data", (batch: BatchToPusherRoomMessage) => {
            for (const message of batch.payload) {
                if (!message.message) {
                    Sentry.captureException("Message is undefined for backConnection in PusherRoom" + this.roomUrl);
                    console.error("Message is undefined for backConnection in PusherRoom");
                    continue;
                }
                switch (message.message.$case) {
                    case "variableMessage": {
                        const variableMessage = message.message.variableMessage;
                        const readableBy = variableMessage.readableBy;

                        // We need to store all variables to dispatch variables later to the listeners
                        //this.variables.set(variableMessage.name, variableMessage.value, readableBy);

                        // Let's dispatch this variable to all the listeners
                        for (const listener of this.listeners) {
                            const userData = socketManager.getConnectedSocketData(listener);
                            if (!userData) {
                                continue;
                            }
                            if (!readableBy || userData.tags.includes(readableBy)) {
                                userData.emitInBatch({
                                    message: {
                                        $case: "variableMessage",
                                        variableMessage: variableMessage,
                                    },
                                });
                            }
                        }
                        break;
                    }
                    case "editMapCommandMessage": {
                        for (const listener of this.listeners) {
                            const userData = socketManager.getSocketData(listener);

                            if (!userData) {
                                continue;
                            }

                            userData.emitInBatch({
                                message: {
                                    $case: "editMapCommandMessage",
                                    editMapCommandMessage: message.message.editMapCommandMessage,
                                },
                            });
                            // In case the message is updating the megaphone settings, we need to send an additional
                            // message to update the display of the megaphone button. The Megaphone button is displayed
                            // based on roles so we need to do this in the pusher.
                            if (
                                message.message.editMapCommandMessage.editMapMessage?.message?.$case ===
                                    "updateWAMSettingsMessage" &&
                                message.message.editMapCommandMessage.editMapMessage.message.updateWAMSettingsMessage
                                    .message?.$case === "updateMegaphoneSettingMessage"
                            ) {
                                if (!this._wamSettings) {
                                    this._wamSettings = {};
                                }
                                this._wamSettings.megaphone =
                                    message.message.editMapCommandMessage.editMapMessage.message.updateWAMSettingsMessage.message.updateMegaphoneSettingMessage;
                                    userData.emitInBatch({
                                    message: {
                                        $case: "megaphoneSettingsMessage",
                                        megaphoneSettingsMessage: {
                                            enabled: WAMSettingsUtils.canUseMegaphone(this._wamSettings, userData.tags),
                                            url: WAMSettingsUtils.getMegaphoneUrl(
                                                this._wamSettings,
                                                new URL(this.roomUrl).host,
                                                this.roomUrl
                                            ),
                                        },
                                    },
                                });
                            }
                        }
                        break;
                    }
                    case "errorMessage": {
                        const errorMessage = message.message.errorMessage;
                        // Let's dispatch this error to all the listeners
                        for (const listener of this.listeners) {
                            const userData = socketManager.getSocketData(listener);

                            if (!userData) {
                                continue;
                            }

                            userData.emitInBatch({
                                message: {
                                    $case: "errorMessage",
                                    errorMessage: errorMessage,
                                },
                            });
                        }
                        break;
                    }
                    case "joinMucRoomMessage": {
                        // Let's dispatch this joinMucRoomMessage to all the listeners
                        for (const listener of this.listeners) {
                            const userData = socketManager.getSocketData(listener);

                            if (!userData) {
                                continue;
                            }
                            userData.emitInBatch({
                                message: {
                                    $case: "joinMucRoomMessage",
                                    joinMucRoomMessage: message.message.joinMucRoomMessage,
                                },
                            });
                        }
                        break;
                    }
                    case "leaveMucRoomMessage": {
                        // Let's dispatch this leaveMucRoomMessage to all the listeners
                        for (const listener of this.listeners) {
                            const userData = socketManager.getSocketData(listener);

                            if (!userData) {
                                continue;
                            }
                            userData.emitInBatch({
                                message: {
                                    $case: "leaveMucRoomMessage",
                                    leaveMucRoomMessage: message.message.leaveMucRoomMessage,
                                },
                            });
                        }
                        break;
                    }
                    default: {
                        const _exhaustiveCheck: never = message.message;
                    }
                }
            }
        });

        this.backConnection.on("error", (err) => {
            if (!this.isClosing) {
                debug("Error on back connection");
                this.close();
                // Let's close all connections linked to that room
                for (const listener of this.listeners) {
                    const userData = socketManager.getSocketData(listener);

                    if (!userData) {
                        continue;
                    }
                    Sentry.captureMessage(
                        "Connection error between pusher and back server : " +
                            err +
                            " " +
                            this.roomUrl +
                            " " +
                            userData.userUuid,
                        "debug"
                    );
                    listener.emit("error", {
                        reason: "Connection error between pusher and back server",
                    });
                    console.error("Connection error between pusher and back server", err);
                    listener.disconnect(true);
                }
            }
        });
        this.backConnection.on("close", () => {
            if (!this.isClosing) {
                debug("Close on back connection", this.roomUrl);
                this.close();
                // Let's close all connections linked to that room
                for (const listener of this.listeners) {
                    const userData = socketManager.getSocketData(listener);
                    if (!userData) {
                        continue;
                    }
                    Sentry.captureMessage(
                        "Close on back connection " + this.roomUrl + " " + userData.userUuid,
                        "debug"
                    );
                    listener.emit("error", {
                        reason: "Connection closed between pusher and back server",
                    });
                    listener.disconnect(true);
                }
            }
        });
    }

    public close(): void {
        debug("Closing connection to room %s on back server", this.roomUrl);
        this.isClosing = true;
        this.backConnection.cancel();
    }

    public customJsonReplacer(key: unknown, value: unknown): string | undefined {
        if (key === "backConnection") {
            const backConnection = value as ClientReadableStream<BatchToPusherRoomMessage> | undefined;
            return backConnection ? "backConnection" : "undefined";
        }
        return undefined;
    }
}
