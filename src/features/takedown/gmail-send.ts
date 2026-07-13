import { google } from "googleapis";
import { config } from "../../config.js";
import { getGmailConnection } from "../auth/gmail.service.js";

export async function sendWithGmail(
  connectionId: string,
  to: string,
  subject: string,
  body: string,
) {
  const connection = getGmailConnection(connectionId);

  const auth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );

  auth.setCredentials(connection.tokens);

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  const message = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    body,
  ].join("\n");

  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
    },
  });
}