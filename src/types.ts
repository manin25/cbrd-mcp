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
  annualReturns?: AnnualReturn[];
}

export interface PersonRole {
  name: string;
  role: string;
  appointmentDate?: string;
  address?: string;
}

export interface PersonSearchResult {
  personName: string;
  role: string;
  companyName: string;
  fileNumber: string;
  appointmentDate?: string;
}

export interface FinancialInfo {
  fileNumber: string;
  companyName: string;
  financialStatements: FinancialStatement[];
}

export interface FinancialStatement {
  year: string;
  filingDate?: string;
  type?: string;
  status?: string;
}

export interface AnnualReturn {
  year: string;
  filingDate?: string;
  status?: string;
}

export interface SearchParams {
  query: string;
  maxResults?: number;
}

export interface LookupParams {
  fileNumber?: string;
  brn?: string;
}
