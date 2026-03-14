import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchCompany } from './scraper/search.js';
import { lookupCompany } from './scraper/lookup.js';
import { getCompanyDetails } from './scraper/details.js';
import { searchPerson } from './scraper/person-search.js';
import { getFinancialInfo } from './scraper/financials.js';
import { getCached, setCache } from './cache.js';
import type { CompanySearchResult, CompanyDetails, PersonSearchResult, FinancialInfo } from './types.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'cbrd-mcp',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Tool 1: Search companies by name
  server.tool(
    'cbrd_search_company',
    'Search for companies on the Mauritius CBRD registry by name. Returns a list of matching companies with basic info (name, file number, BRN, status, type).',
    {
      query: z.string().min(1).max(200).describe('Company name or partial name to search'),
      max_results: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of results to return'),
    },
    async ({ query, max_results }) => {
      try {
        const params = { query, max_results };
        const cached = getCached<CompanySearchResult[]>('cbrd_search_company', params);
        if (cached) {
          return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
        }

        const results = await searchCompany(query, max_results);
        setCache('cbrd_search_company', params, results);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No companies found matching "${query}".` }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error searching companies: ${msg}` }], isError: true };
      }
    },
  );

  // Tool 2: Lookup company by file number or BRN
  server.tool(
    'cbrd_lookup_company',
    'Look up a specific company by file number or Business Registration Number (BRN) on the Mauritius CBRD registry.',
    {
      file_number: z.string().optional().describe('Company/Partnership file number'),
      brn: z.string().optional().describe('Business Registration Number'),
    },
    async ({ file_number, brn }) => {
      if (!file_number && !brn) {
        return { content: [{ type: 'text', text: 'At least one of file_number or brn must be provided.' }], isError: true };
      }

      try {
        const params = { file_number, brn };
        const cached = getCached<CompanySearchResult[]>('cbrd_lookup_company', params);
        if (cached) {
          return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
        }

        const results = await lookupCompany(file_number, brn);
        setCache('cbrd_lookup_company', params, results);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No company found with ${file_number ? `file number "${file_number}"` : `BRN "${brn}"`}.` }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error looking up company: ${msg}` }], isError: true };
      }
    },
  );

  // Tool 3: Get full company details
  server.tool(
    'cbrd_company_details',
    'Get full details for a specific company from Mauritius CBRD, including directors, shareholders, registered office, and other available information.',
    {
      file_number: z.string().min(1).describe('The company file number to get details for'),
    },
    async ({ file_number }) => {
      try {
        const params = { file_number };
        const cached = getCached<CompanyDetails>('cbrd_company_details', params);
        if (cached) {
          return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
        }

        const details = await getCompanyDetails(file_number);
        setCache('cbrd_company_details', params, details, true);

        return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error getting company details: ${msg}` }], isError: true };
      }
    },
  );

  // Tool 4: Search for a person
  server.tool(
    'cbrd_search_person',
    "Search for a person's name across Mauritius CBRD company records to find companies they are associated with as director, shareholder, or secretary.",
    {
      name: z.string().min(1).describe("Person's name to search"),
      role: z.enum(['director', 'shareholder', 'secretary', 'all']).optional().default('all').describe('Filter by role'),
    },
    async ({ name, role }) => {
      try {
        const params = { name, role };
        const cached = getCached<PersonSearchResult[]>('cbrd_search_person', params);
        if (cached) {
          return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
        }

        const results = await searchPerson(name, role);
        setCache('cbrd_search_person', params, results);

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No records found for person "${name}"${role !== 'all' ? ` with role "${role}"` : ''}.` }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error searching for person: ${msg}` }], isError: true };
      }
    },
  );

  // Tool 5: Get financial info
  server.tool(
    'cbrd_financial_info',
    'Retrieve financial information for a company from the Mauritius CBRD free search, if available.',
    {
      file_number: z.string().min(1).describe('The company file number'),
    },
    async ({ file_number }) => {
      try {
        const params = { file_number };
        const cached = getCached<FinancialInfo>('cbrd_financial_info', params);
        if (cached) {
          return { content: [{ type: 'text', text: JSON.stringify(cached, null, 2) }] };
        }

        const info = await getFinancialInfo(file_number);
        setCache('cbrd_financial_info', params, info, true);

        if (info.financialStatements.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No financial information available for ${info.companyName} (${file_number}) on the free CBRD search. Financial details may require the paid CBRIS service.`,
            }],
          };
        }

        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error getting financial info: ${msg}` }], isError: true };
      }
    },
  );

  return server;
}
