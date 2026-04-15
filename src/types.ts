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
  members?: MemberInfo[];
  certificates?: CertificateInfo[];
  annualReturns?: AnnualReturn[];
  financialSummaries?: FinancialSummaryFiled[];
  lastFinancialSummary?: FinancialSummary;
  charges?: ChargeInfo[];
  windingUp?: WindingUpInfo[];
  objections?: ObjectionInfo[];
  lastAnnualRegistrationFeePaid?: string;
  extractNotes?: ExtractNote[];
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

export interface MemberInfo {
  name: string;
  amount?: string;
  startDate?: string;
  currency?: string;
}

export interface CertificateInfo {
  certificate?: string;
  type?: string;
  effectiveDate?: string;
  expiryDate?: string;
}

export interface AnnualReturn {
  dateAnnualReturn?: string;
  annualMeetingDate?: string;
  dateFiled?: string;
}

export interface FinancialSummaryFiled {
  financialYearEnded?: string;
  currency?: string;
  dateApproved?: string;
}

export interface FinancialSummary {
  financialYearEnded?: string;
  currency?: string;
  dateApproved?: string;
  unit?: string;
  profitAndLoss?: ProfitAndLoss;
  balanceSheet?: BalanceSheet;
}

export interface ProfitAndLoss {
  turnover?: string;
  costOfSales?: string;
  grossProfit?: string;
  otherIncome?: string;
  distributionCosts?: string;
  administrationCosts?: string;
  otherExpenses?: string;
  financeCosts?: string;
  profitBeforeTax?: string;
  taxExpense?: string;
  profitForPeriod?: string;
  totalComprehensiveIncome?: string;
}

export interface BalanceSheet {
  nonCurrentAssets?: {
    propertyPlantEquipment?: string;
    investmentProperties?: string;
    intangibleAssets?: string;
    otherInvestments?: string;
    investmentInSubsidiaries?: string;
    biologicalAssets?: string;
    others?: string;
    total?: string;
  };
  currentAssets?: {
    inventories?: string;
    tradeAndOtherReceivables?: string;
    cashAndCashEquivalents?: string;
    others?: string;
    total?: string;
  };
  totalAssets?: string;
  equityAndLiabilities?: {
    shareCapital?: string;
    otherReserves?: string;
    retainedEarnings?: string;
    others?: string;
    total?: string;
  };
  nonCurrentLiabilities?: {
    longTermBorrowings?: string;
    deferredTax?: string;
    longTermProvisions?: string;
    others?: string;
    total?: string;
  };
  currentLiabilities?: {
    tradeAndOtherPayables?: string;
    shortTermBorrowings?: string;
    currentTaxPayable?: string;
    shortTermProvisions?: string;
    others?: string;
    total?: string;
  };
  totalLiabilities?: string;
  totalEquityAndLiabilities?: string;
}

export interface ChargeInfo {
  volume?: string;
  property?: string;
  nature?: string;
  amount?: string;
  dateCharged?: string;
  dateFiled?: string;
  currency?: string;
}

export interface WindingUpInfo {
  type?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export interface ObjectionInfo {
  objectionDate?: string;
  objector?: string;
}

export interface ExtractNote {
  serialId?: string;
  notes?: string;
}

export interface SearchParams {
  query: string;
  maxResults?: number;
}

export interface LookupParams {
  fileNumber?: string;
  brn?: string;
}
