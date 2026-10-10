import "server-only";

// Founder pipeline: new QUALIFIED calls only become a HubSpot contact + deal.
export function hubspotConfigured() {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN);
}

async function hubspot(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function createContactAndDeal(input: {
  name: string;
  phone: string | null;
  locality: string | null;
  dealName: string;
  note: string;
}): Promise<{ contactId: string; dealId: string } | null> {
  if (!hubspotConfigured()) return null;
  const [firstname, ...rest] = input.name.split(" ");

  let contact = await hubspot("/crm/v3/objects/contacts", {
    properties: {
      firstname,
      lastname: rest.join(" "),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.locality ? { city: input.locality } : {}),
      hs_lead_status: "NEW",
    },
  });
  // 409 = a contact with this phone/email already exists; reuse it
  if (contact.status === 409) {
    const existingId = String(contact.json.message ?? "").match(/Existing ID: (\d+)/)?.[1];
    if (existingId) contact = { ok: true, status: 200, json: { id: existingId } };
  }
  if (!contact.ok) throw new Error(`HubSpot contact ${contact.status}: ${JSON.stringify(contact.json).slice(0, 200)}`);

  const deal = await hubspot("/crm/v3/objects/deals", {
    properties: {
      dealname: input.dealName,
      pipeline: "default",
      dealstage: "appointmentscheduled",
      description: input.note.slice(0, 5000),
    },
    // 3 = HubSpot-defined deal → contact association
    associations: [
      { to: { id: contact.json.id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] },
    ],
  });
  if (!deal.ok) throw new Error(`HubSpot deal ${deal.status}: ${JSON.stringify(deal.json).slice(0, 200)}`);
  return { contactId: String(contact.json.id), dealId: String(deal.json.id) };
}
