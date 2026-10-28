// {n} is replaced with the tracking number
export const carriers = [
  { name: "Royal Mail", url: "https://www.royalmail.com/track-your-item#/tracking-results/{n}" },
  { name: "Canada Post", url: "https://www.canadapost-postescanada.ca/track-reperage/en#/details/{n}" },
  { name: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels={n}" },
  { name: "UPS", url: "https://www.ups.com/track?tracknum={n}" },
  { name: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { name: "DHL", url: "https://www.dhl.com/global-en/home/tracking.html?tracking-id={n}" },
  { name: "Other", url: "" },
] as const;

export const trackingUrl = (carrier: string | null, number: string | null) => {
  const c = carriers.find((x) => x.name === carrier);
  return c && c.url && number ? c.url.replace("{n}", encodeURIComponent(number)) : null;
};
