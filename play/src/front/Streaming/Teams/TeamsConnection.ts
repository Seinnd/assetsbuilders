import { BroadcastConnection } from "../Common/BroadcastConnection";
import { TeamsCallAgent, CallClient, CallAgent } from "@azure/communication-calling";
import { AzureCommunicationTokenCredential } from "@azure/communication-common";
import { CommunicationIdentityClient } from "@azure/communication-identity";
import { z } from "zod";

const AccessToken = z.object({
    appid: z.string(),
    oid: z.string(),
});

type AccessToken = z.infer<typeof AccessToken>;

export class TeamsConnection implements BroadcastConnection {
    constructor(readonly callAgent: CallAgent | TeamsCallAgent) {}

    public static async generate(displayName: string, userAccessToken?: string): Promise<TeamsConnection> {
        const callClient = new CallClient();

        let token: string | undefined = undefined;

        // Todo block: The token should be generated by the admin but in this example we are using a token generated by the Azur test tool
        const connectionString = ``;
        const client = new CommunicationIdentityClient(connectionString);

        if (userAccessToken) {
            try {
                const parsedAccessToken = this.parseAccessToken(userAccessToken);

                token = (await client.getTokenForTeamsUser({
                    teamsUserAadToken: userAccessToken,
                    clientId: parsedAccessToken.appid,
                    userObjectId: parsedAccessToken.oid,
                })).token;

                const credential = new AzureCommunicationTokenCredential(token);
                return new this(await callClient.createTeamsCallAgent(credential, {displayName}));
            } catch (error) {
                console.error(error);
            }
        }

        if (!token) {
            const anonymousUser = await client.createUserAndToken(["chat", "voip"]);
            token = anonymousUser.token;
        }
        // Todo block: This is the token that should be generated by the admin

        const credential = new AzureCommunicationTokenCredential(token);
        return new this(await callClient.createCallAgent(credential, {displayName}));
    }

    /**
     * Parse the Access Token
     * @param token The Access Token to parse
     * @returns The parsed Access Token
     */
    private static parseAccessToken(token: string): AccessToken {
        const base64Url = token.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            window
                .atob(base64)
                .split("")
                .map(function (c) {
                    return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
                })
                .join("")
        );

        return AccessToken.parse(JSON.parse(jsonPayload));
    }

    disconnect(): Promise<void> {
        return this.callAgent.dispose();
    }
}