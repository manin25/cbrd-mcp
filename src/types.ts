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
  registrationDate?: string;
  registeredOffice?: string;
  natureOfBusiness?: string;
  directors: PersonRole[];
  shareholders: PersonRole[];
  secretaries: PersonRole[];
}

export interface PersonRole {
  name: string;
  role: string;
  appointmentDate?: string;
  address?: string;
}

export interface SearchParams {
  query: string;
  maxResults?: number;
}

export interface LookupParams {
  fileNumber?: string;
  brn?: string;
}
