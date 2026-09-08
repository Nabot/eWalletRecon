/** Display MSISDN when present, otherwise sender name. */
export function formatSender(d: {
  senderMsisdn?: string | null;
  senderName?: string | null;
}): string {
  if (d.senderMsisdn) return d.senderMsisdn;
  if (d.senderName) return d.senderName;
  return "—";
}
