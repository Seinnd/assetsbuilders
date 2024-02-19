import { EntityRawPrefab, mapCustomEntityDirectionToDirection, UploadEntityCommand } from "@workadventure/map-editor";
import { UploadEntityMessage } from "@workadventure/messages";
import { RoomConnection } from "../../../../../Connection/RoomConnection";
import { gameManager } from "../../../GameManager";
import { FrontCommand } from "../FrontCommand";

export class UploadEntityFrontCommand extends UploadEntityCommand implements FrontCommand {
    constructor(uploadEntityMessage: UploadEntityMessage) {
        super(uploadEntityMessage);
    }

    emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorUploadEntity(this.commandId, this.uploadEntityMessage);
    }
    execute(): Promise<void> {
        const customEntityCollectionUrl = gameManager.getCurrentGameScene().getCustomEntityCollectionUrl();
        try {
            const uploadedEntity = EntityRawPrefab.parse({
                ...this.uploadEntityMessage,
                direction: mapCustomEntityDirectionToDirection(this.uploadEntityMessage.direction),
            });
            gameManager
                .getCurrentGameScene()
                .getEntitiesCollectionsManager()
                .addUploadedEntity(uploadedEntity, customEntityCollectionUrl);
        } catch (e) {
            console.error(e);
        }

        return super.execute();
    }

    getUndoCommand(): UploadEntityFrontCommand {
        return new UploadEntityFrontCommand(this.uploadEntityMessage);
    }
}
