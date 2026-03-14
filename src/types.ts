export interface CompanySearchResult {
  companyName: string;
  fileNumber: string;
  brn?: string;
  status?: string;
  type?: string;
}

export interface CompanyDetails {
  companyName: string;
  fileNumber: string;
  brn?: string;
  status?: string;
  type?: string;
  nature?: string;
  category?: string;
  subCategory?: string;
  registrationDate?: string;
  registeredOffice?: string;
  effectiveDateRegisteredOffice?: string;
  natureOfBusiness?: string;
  businessDetails?: BusinessDetail[];
  statedCapital?: StatedCapital[];
  directors: PersonRole[];
  shareholders: ShareholderInfo[];
  secretaries: PersonRole[];
}

export interface PersonRole {
  name: string;
  role: string;
  appointmentDate?: string;
  address?: string;
}

export interface ShareholderInfo {
  name: string;
  numberOfShares?: string;
  typeOfShares?: string;
  currency?: string;
}

export interface BusinessDetail {
  brn?: string;
  businessName?: string;
  natureOfBusiness?: string;
  businessAddress?: string;
}

export interface StatedCapital {
  typeOfShares?: string;
  numberOfShares?: string;
  currency?: string;
  statedCapital?: string;
  amountUnpaid?: string;
  parValue?: string;
}

export interface SearchParams {
  query: string;
  maxResults?: number;
}

export interface LookupParams {
  fileNumber?: string;
  brn?: string;
}
