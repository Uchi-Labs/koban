const knownPlaidInstitutionNames: Record<string, string> = {
  ins_138259: "Coinbase One Card",
  ins_126339: "SoFi",
  ins_33: "Discover"
};

const simpleFinStandbyPlaidInstitutionIds = new Set(["ins_126339", "ins_33"]);

export interface PlaidStandbyItem {
  errorMessage?: string;
  institutionId?: string;
}

export function plaidInstitutionName(institutionId: string | undefined): string {
  return institutionId ? (knownPlaidInstitutionNames[institutionId] ?? institutionId) : "Plaid institution";
}

export function healthyPlaidStandbyInstitutionIds(items: PlaidStandbyItem[]): Set<string> {
  return new Set(
    items
      .filter((item) => !item.errorMessage && item.institutionId && simpleFinStandbyPlaidInstitutionIds.has(item.institutionId))
      .map((item) => item.institutionId as string)
  );
}

function simpleFinPlaidStandbyInstitutionId({
  accountName,
  orgDisplayName,
  orgKey
}: {
  accountName: string;
  orgDisplayName?: string;
  orgKey?: string;
}): string | undefined {
  const haystack = [accountName, orgDisplayName, orgKey].filter(Boolean).join(" ").toLowerCase();

  if (/\bsofi\b/.test(haystack) || haystack.includes("sofi.com")) {
    return "ins_126339";
  }

  if (haystack.includes("discover") || haystack.includes("vishhvak")) {
    return "ins_33";
  }

  return undefined;
}

export function isSimpleFinAccountOnPlaidStandby(input: {
  accountName: string;
  healthyPlaidInstitutionIds: Set<string>;
  orgDisplayName?: string;
  orgKey?: string;
}): boolean {
  const standbyInstitutionId = simpleFinPlaidStandbyInstitutionId(input);
  return standbyInstitutionId ? input.healthyPlaidInstitutionIds.has(standbyInstitutionId) : false;
}
