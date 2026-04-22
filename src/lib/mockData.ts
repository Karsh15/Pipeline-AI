export type DealStatus = "LOI" | "Underwriting" | "Tracking" | "Dead";

export type AgentStatus = "pending" | "processing" | "complete" | "failed";

export interface AIAgents {
  metadata: AgentStatus;
  summary: AgentStatus;
  questions: AgentStatus;
  criteria: AgentStatus;
  financial: AgentStatus;
  risks: AgentStatus;
}

export interface FinancialRow {
  metric: string;
  y2021: number;
  y2022: number;
  y2023: number;
  ttm: number;
}

export interface CriteriaRow {
  criteria: string;
  requirement: string;
  actual: string;
  meets: boolean;
}

export interface Note {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  name: string;
  status: DealStatus;
  assetType: string;
  propertyType: string;
  broker: string;
  dealLead: string;
  brand: string;
  units: number;
  guidancePrice: number;
  yearBuilt: number;
  address: string;
  city: string;
  state: string;
  addedAt: string;
  lat: number;
  lng: number;
  agents: AIAgents;
  amenities: string[];
  files: { name: string; type: "pdf" | "xlsx" | "docx" | "csv"; url?: string }[];
  notes: Note[];
  financials: FinancialRow[];
  criteria: CriteriaRow[];
  questions: string[];
  risks: string[];
  brokerNarrative: string;
  locationInsight: string;
  noi: number;
  capRate: number;
  interestType?: string;
  sf?: number;
  brandParentCompany?: string;
  salePrice?: number;
}

export const mockDeals: Deal[] = [
  {
    id: "DL-1001",
    name: "Sunrise Hotel Plaza",
    status: "Underwriting",
    assetType: "Hospitality",
    propertyType: "Full Service Hotel",
    broker: "CBRE",
    dealLead: "Jessica Moore",
    brand: "Marriott",
    units: 350,
    guidancePrice: 42500000,
    yearBuilt: 2012,
    address: "123 Sunrise Way",
    city: "Miami",
    state: "FL",
    addedAt: "2026-04-10T10:00:00Z",
    lat: 25.7617,
    lng: -80.1918,
    noi: 1312557,
    capRate: 6.2,
    agents: { metadata: "complete", summary: "complete", questions: "complete", criteria: "complete", financial: "complete", risks: "processing" },
    amenities: ["Pool", "Fitness Center", "Conference Rooms (13)", "Restaurant", "Business Center"],
    files: [
      { name: "Sunrise_Hotel_OM_2026.pdf", type: "pdf", url: "https://pdfobject.com/pdf/sample.pdf" },
      { name: "T12_Financials.xlsx", type: "xlsx", url: "https://go.microsoft.com/fwlink/?LinkID=521962" },
      { name: "Rent_Roll_Q1.csv", type: "csv", url: "https://raw.githubusercontent.com/datasciencedojo/datasets/master/titanic.csv" },
    ],
    notes: [
      { id: "n1", author: "Jessica Moore", text: "CBRE confirmed bidding deadline is April 30. Strong interest from two other institutional groups.", createdAt: "2026-04-11T09:15:00Z" },
      { id: "n2", author: "Mike Chen", text: "Expense ratio concern flagged by AI — need to dig into management fees vs. competitive set.", createdAt: "2026-04-12T14:30:00Z" },
    ],
    financials: [
      { metric: "Total Revenue", y2021: 3105612, y2022: 4958188, y2023: 5881654, ttm: 5938774 },
      { metric: "GOP", y2021: 1052282, y2022: 1327689, y2023: 1941580, ttm: 1972672 },
      { metric: "EBITDA", y2021: 777026, y2022: 953033, y2023: 1522744, ttm: 1550108 },
      { metric: "NOI", y2021: 652801, y2022: 754706, y2023: 1287478, ttm: 1312557 },
    ],
    criteria: [
      { criteria: "NOI Margin", requirement: "> 22%", actual: "22.1%", meets: true },
      { criteria: "Year Built", requirement: "Post 2005", actual: "2012", meets: true },
      { criteria: "Market Cap Rate", requirement: "< 7%", actual: "6.2%", meets: true },
      { criteria: "Units", requirement: "> 200", actual: "350", meets: true },
      { criteria: "Guidance Price / Key", requirement: "< $150K", actual: "$121K", meets: true },
    ],
    questions: [
      "What is driving the 40% YoY revenue increase from 2021 to 2022?",
      "Can you confirm the management contract terms and termination rights?",
      "What is the competitive RevPAR vs. comp set for trailing 12 months?",
      "Are there any pending capital expenditure requirements in the next 24 months?",
    ],
    risks: [
      "Expense ratio of 66.8% is high vs. submarket median of 45%",
      "Property tax reassessment likely post-acquisition (~4.2% NOI impact)",
      "Management contract extends 5 years with significant penalties for early exit",
    ],
    brokerNarrative: "The offering is positioned as a value-add opportunity to acquire an underperforming, institutional-quality asset with significant upside potential. The hotel currently underperforms its competitive set (RevPAR of $87 vs. Hampton Inn next door at $106) and the broker believes better leveraging brand capabilities can drive substantial performance improvements.",
    locationInsight: "Located 2 miles from Miami International Airport with direct interstate access. Benefits from proximity to Miami Beach, PortMiami, and multiple Fortune 500 headquarters. Market RevPAR growth has averaged 4.2% annually over the past 5 years.",
  },
  {
    id: "DL-1002",
    name: "Downtown Corporate Tower",
    status: "LOI",
    assetType: "Office",
    propertyType: "Class A Office",
    broker: "JLL",
    dealLead: "Sarah Kim",
    brand: "N/A",
    units: 48,
    guidancePrice: 120000000,
    yearBuilt: 2015,
    address: "450 5th Ave",
    city: "New York",
    state: "NY",
    addedAt: "2026-04-12T14:30:00Z",
    lat: 40.7529,
    lng: -73.9852,
    noi: 5400000,
    capRate: 4.5,
    agents: { metadata: "complete", summary: "complete", questions: "complete", criteria: "complete", financial: "complete", risks: "complete" },
    amenities: ["Full-Floor Plates", "Rooftop Terrace", "Conference Center", "Gym", "EV Parking"],
    files: [
      { name: "Corporate_Tower_OM.pdf", type: "pdf", url: "https://pdfobject.com/pdf/sample.pdf" },
      { name: "Lease_Roll_Summary.xlsx", type: "xlsx", url: "https://go.microsoft.com/fwlink/?LinkID=521962" },
    ],
    notes: [
      { id: "n3", author: "Sarah Kim", text: "LOI submitted April 12. Target close Q3 2026. Anchor tenant WeWork (30% occupancy risk).", createdAt: "2026-04-13T10:00:00Z" },
    ],
    financials: [
      { metric: "Gross Income", y2021: 8200000, y2022: 9500000, y2023: 10200000, ttm: 10400000 },
      { metric: "Operating Expenses", y2021: 4100000, y2022: 4600000, y2023: 4700000, ttm: 5000000 },
      { metric: "NOI", y2021: 4100000, y2022: 4900000, y2023: 5500000, ttm: 5400000 },
      { metric: "EBITDA", y2021: 3800000, y2022: 4500000, y2023: 5100000, ttm: 5000000 },
    ],
    criteria: [
      { criteria: "NOI Margin", requirement: "> 40%", actual: "51.9%", meets: true },
      { criteria: "Cap Rate", requirement: "> 4%", actual: "4.5%", meets: true },
      { criteria: "Year Built", requirement: "Post 2010", actual: "2015", meets: true },
      { criteria: "Single Tenant Risk", requirement: "< 35%", actual: "30% (WeWork)", meets: true },
    ],
    questions: [
      "What are the lease expiration profiles for all top 5 tenants?",
      "What is the WeWork lease structure — traditional or revenue-share?",
      "Are any pending rent abatements or free rent concessions in place?",
    ],
    risks: [
      "WeWork occupies 30% of NLA — significant concentration risk",
      "NYC office market still recovering post-COVID with 18% submarket vacancy",
      "Capital reserve shortfall estimated at $2.1M based on building age",
    ],
    brokerNarrative: "A rare opportunity to acquire a trophy Class A office tower in Midtown Manhattan. The property boasts 100% occupancy with a WALT of 6.2 years across a diversified tenant base anchored by WeWork and several Fortune 500 tenants.",
    locationInsight: "Situated at the crossroads of Midtown and Penn District, steps from Penn Station, Grand Central, and all major subway lines. The building benefits from one of NYC's most accessible transit ecosystems.",
  },
  {
    id: "DL-1003",
    name: "Oakwood Apartments",
    status: "Tracking",
    assetType: "Multifamily",
    propertyType: "Garden-Style Apartments",
    broker: "Cushman & Wakefield",
    dealLead: "Tom Davis",
    brand: "N/A",
    units: 210,
    guidancePrice: 55000000,
    yearBuilt: 2008,
    address: "780 Oak Blvd",
    city: "Austin",
    state: "TX",
    addedAt: "2026-04-05T09:15:00Z",
    lat: 30.2672,
    lng: -97.7431,
    noi: 2750000,
    capRate: 5.0,
    agents: { metadata: "complete", summary: "complete", questions: "pending", criteria: "pending", financial: "complete", risks: "pending" },
    amenities: ["Pool", "Dog Park", "Package Lockers", "EV Charging", "Rooftop Deck"],
    files: [
      { name: "Oakwood_OM_2026.pdf", type: "pdf", url: "https://pdfobject.com/pdf/sample.pdf" },
      { name: "T12_Rent_Roll.xlsx", type: "xlsx", url: "https://go.microsoft.com/fwlink/?LinkID=521962" },
    ],
    notes: [],
    financials: [
      { metric: "Gross Rent", y2021: 3800000, y2022: 4200000, y2023: 5100000, ttm: 5300000 },
      { metric: "Operating Expense", y2021: 1800000, y2022: 2000000, y2023: 2300000, ttm: 2550000 },
      { metric: "NOI", y2021: 2000000, y2022: 2200000, y2023: 2800000, ttm: 2750000 },
      { metric: "EBITDA", y2021: 1900000, y2022: 2100000, y2023: 2650000, ttm: 2600000 },
    ],
    criteria: [
      { criteria: "NOI Margin", requirement: "> 48%", actual: "51.9%", meets: true },
      { criteria: "Year Built", requirement: "Post 2000", actual: "2008", meets: true },
      { criteria: "Market", requirement: "Top 25 MSA", actual: "Austin #12", meets: true },
    ],
    questions: [
      "What is current occupancy and market trend over 6 months?",
      "Is there a new supply pipeline within 1 mile?",
    ],
    risks: [
      "Austin submarket has 8,000+ units under construction within 5 miles",
      "Concessions market — averaging 1.5 months free rent",
    ],
    brokerNarrative: "Oakwood Apartments represents a best-in-class garden-style multifamily opportunity in one of the nation's fastest growing metros. The asset has maintained 94% occupancy throughout recent market softness.",
    locationInsight: "Located in South Austin near the emerging South Congress corridor. 15-minute drive to downtown and major tech employers including Tesla Gigafactory and Oracle campus.",
  },
  {
    id: "DL-1004",
    name: "Desert Oasis Resort",
    status: "Dead",
    assetType: "Hospitality",
    propertyType: "Select Service Hotel",
    broker: "Marcus & Millichap",
    dealLead: "Jessica Moore",
    brand: "Hilton",
    units: 150,
    guidancePrice: 22000000,
    yearBuilt: 1999,
    address: "1000 Desert Rd",
    city: "Scottsdale",
    state: "AZ",
    addedAt: "2026-03-20T11:45:00Z",
    lat: 33.4942,
    lng: -111.9261,
    noi: 750000,
    capRate: 3.4,
    agents: { metadata: "complete", summary: "complete", questions: "complete", criteria: "complete", financial: "complete", risks: "complete" },
    amenities: ["Pool", "Spa", "Golf Course Access"],
    files: [
      { name: "Desert_Oasis_OM.pdf", type: "pdf", url: "https://pdfobject.com/pdf/sample.pdf" },
    ],
    notes: [
      { id: "n4", author: "Jessica Moore", text: "Passed — cap rate too compressed at 3.4% for a 1999-vintage select service. Moving on.", createdAt: "2026-03-25T16:00:00Z" },
    ],
    financials: [
      { metric: "Total Revenue", y2021: 4200000, y2022: 5100000, y2023: 5800000, ttm: 5900000 },
      { metric: "GOP", y2021: 1050000, y2022: 1275000, y2023: 1450000, ttm: 1475000 },
      { metric: "NOI", y2021: 600000, y2022: 680000, y2023: 740000, ttm: 750000 },
      { metric: "EBITDA", y2021: 550000, y2022: 630000, y2023: 700000, ttm: 720000 },
    ],
    criteria: [
      { criteria: "Cap Rate", requirement: "> 6%", actual: "3.4%", meets: false },
      { criteria: "Year Built", requirement: "Post 2000", actual: "1999", meets: false },
      { criteria: "NOI Margin", requirement: "> 15%", actual: "12.7%", meets: false },
    ],
    questions: [],
    risks: [
      "1999 vintage likely requires $4-6M in immediate FF&E replacement",
      "Cap rate at 3.4% leaves no room for error or market softening",
    ],
    brokerNarrative: "Desert Oasis Resort is a proven performer in the strong Scottsdale leisure market. The property benefits from year-round demand driven by golf, spa, and corporate events.",
    locationInsight: "Located in North Scottsdale's premier resort corridor. Strong leisure demand with proximity to top golf courses and the Scottsdale Fashion Square.",
  },
];

export const formatCurrency = (amount: number): string => {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
};

export const formatCurrencyFull = (amount: number): string => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
};
