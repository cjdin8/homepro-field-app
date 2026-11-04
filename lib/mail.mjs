// Sends the job packet from cdinsmore@homepromobility.com through Gmail SMTP (Google app password).
import nodemailer from "nodemailer";

const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);
export const DEFAULT_TO = [
  "Natalie Tefft <ntefft@homepromobility.com>",
  "Team Pathway HomePro <teampathway@homepromobility.com>",
  "Paul St. Angelo <pstangelo@homepromobility.com>",
  "install@homepromobility.com",
];
export const recipients = () => (env("JOB_EMAIL_TO") ? env("JOB_EMAIL_TO").split(";").map((s) => s.trim()).filter(Boolean) : DEFAULT_TO);

let transport;
function getTransport() {
  if (transport) return transport;
  if (env("MAIL_TEST") === "1") { transport = nodemailer.createTransport({ jsonTransport: true }); return transport; }
  const user = String(env("SMTP_USER") || "cdinsmore@homepromobility.com").trim();
  const pass = String(env("SMTP_PASS") || "").replace(/\s+/g, "");
  if (!pass) throw new Error("SMTP_PASS (Google app password) is not set in Netlify");
  transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  return transport;
}

/** subject = "<JOB#>: <Last name>" */
export async function sendPacket({ subject, text, filename, pdf, cc }) {
  const user = env("SMTP_USER") || "cdinsmore@homepromobility.com";
  const info = await getTransport().sendMail({
    from: `CJ Dinsmore <${user}>`,
    to: recipients(),
    cc: cc || undefined,
    subject,
    text,
    attachments: [{ filename, content: Buffer.from(pdf), contentType: "application/pdf" }],
  });
  return { messageId: info.messageId, test: env("MAIL_TEST") === "1" ? JSON.parse(info.message) : undefined };
}
