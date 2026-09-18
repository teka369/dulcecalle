export type AuthedUser = { id: string; email: string };

export type BusinessContext = {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  timezone: string;
};
