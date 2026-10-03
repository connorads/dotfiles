// Thin wrapper over the SMS provider. Real credentials live in the deployment env.
export async function sendSms(to: string, body: string): Promise<void> {
  const res = await fetch("https://api.sms-provider.example/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SMS_API_KEY ?? ""}` },
    body: JSON.stringify({ to, body, from: "Northgate" }),
  });
  if (!res.ok) throw new Error(`sms send failed: ${res.status}`);
}
