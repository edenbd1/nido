export interface Visit {
  address: string;
  status: "pending" | "funded";
  createdAt: number;
}

export const visits = new Map<string, Visit>();

export function getPending(): [string, Visit][] {
  return [...visits].filter(([, v]) => v.status === "pending");
}