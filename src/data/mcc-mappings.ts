/**
 * Static MCC (Merchant Category Code) → macro category mapping.
 *
 * Covers the ~250 most common MCC codes that European PSD2 banks might
 * return. Each code maps to a macro category NAME (not id - ids differ
 * per workspace and are resolved at seed time).
 *
 * Source: github.com/greggles/mcc-codes (public domain). The raw CSV
 * has ~900 codes; this list focuses on the ones actually used by
 * consumer-facing card/POS transactions.
 *
 * NOTE: Enable Banking does NOT currently return MCC codes in its
 * transaction responses, so in practice this table is dormant at bank
 * sync time. It exists for:
 *   1) future bank integrations that do expose MCC,
 *   2) manual rule creation on the /rules page, and
 *   3) Stage 3 of the categorization cascade as a last-resort fallback
 *      when a transaction happens to arrive with an MCC populated.
 */

export interface MccMapping {
  code: string;
  macroName: string;
  description: string;
}

export const MCC_MAPPINGS: MccMapping[] = [
  // ── Food & Dining ─────────────────────────────────────────────────
  { code: '5411', macroName: 'Food & Dining',  description: 'Grocery Stores, Supermarkets' },
  { code: '5412', macroName: 'Food & Dining',  description: 'Grocery Stores, Supermarkets (alt)' },
  { code: '5422', macroName: 'Food & Dining',  description: 'Freezer and Locker Meat Provisioners' },
  { code: '5441', macroName: 'Food & Dining',  description: 'Candy, Nut, and Confectionery Stores' },
  { code: '5451', macroName: 'Food & Dining',  description: 'Dairy Products Stores' },
  { code: '5462', macroName: 'Food & Dining',  description: 'Bakeries' },
  { code: '5499', macroName: 'Food & Dining',  description: 'Miscellaneous Food Stores' },
  { code: '5811', macroName: 'Food & Dining',  description: 'Caterers' },
  { code: '5812', macroName: 'Food & Dining',  description: 'Eating Places, Restaurants' },
  { code: '5813', macroName: 'Food & Dining',  description: 'Drinking Places (Alcoholic Beverages), Bars, Taverns' },
  { code: '5814', macroName: 'Food & Dining',  description: 'Fast Food Restaurants' },

  // ── Transportation ────────────────────────────────────────────────
  { code: '4111', macroName: 'Transportation', description: 'Local/Suburban Commuter Passenger Transportation' },
  { code: '4112', macroName: 'Transportation', description: 'Passenger Railways' },
  { code: '4121', macroName: 'Transportation', description: 'Taxicabs and Limousines' },
  { code: '4131', macroName: 'Transportation', description: 'Bus Lines' },
  { code: '4784', macroName: 'Transportation', description: 'Tolls and Bridge Fees' },
  { code: '4789', macroName: 'Transportation', description: 'Transportation Services (Not Elsewhere Classified)' },
  { code: '5541', macroName: 'Transportation', description: 'Service Stations (with or without Ancillary Services)' },
  { code: '5542', macroName: 'Transportation', description: 'Automated Fuel Dispensers' },
  { code: '5172', macroName: 'Transportation', description: 'Petroleum and Petroleum Products' },
  { code: '5571', macroName: 'Transportation', description: 'Motorcycle Shops and Dealers' },
  { code: '5592', macroName: 'Transportation', description: 'Motor Homes Dealers' },
  { code: '5598', macroName: 'Transportation', description: 'Snowmobile Dealers' },
  { code: '5599', macroName: 'Transportation', description: 'Miscellaneous Auto Dealers' },
  { code: '7511', macroName: 'Transportation', description: 'Truck Stop Transactions' },
  { code: '7512', macroName: 'Transportation', description: 'Car Rental Agencies' },
  { code: '7513', macroName: 'Transportation', description: 'Truck and Utility Trailer Rentals' },
  { code: '7519', macroName: 'Transportation', description: 'Motor Home and Recreational Vehicle Rentals' },
  { code: '7523', macroName: 'Transportation', description: 'Parking Lots, Garages' },
  { code: '7531', macroName: 'Transportation', description: 'Automotive Body Repair Shops' },
  { code: '7534', macroName: 'Transportation', description: 'Tire Retreading and Repair Shops' },
  { code: '7535', macroName: 'Transportation', description: 'Automotive Paint Shops' },
  { code: '7538', macroName: 'Transportation', description: 'Automotive Service Shops' },
  { code: '7542', macroName: 'Transportation', description: 'Car Washes' },
  { code: '7549', macroName: 'Transportation', description: 'Towing Services' },

  // ── Housing ───────────────────────────────────────────────────────
  { code: '6513', macroName: 'Housing',        description: 'Real Estate Agents and Managers - Rentals' },
  { code: '1520', macroName: 'Housing',        description: 'General Contractors (Residential and Commercial)' },
  { code: '1711', macroName: 'Housing',        description: 'Heating, Plumbing, A/C Contractors' },
  { code: '1731', macroName: 'Housing',        description: 'Electrical Contractors' },
  { code: '1740', macroName: 'Housing',        description: 'Masonry, Stonework, Tile Setting' },
  { code: '1750', macroName: 'Housing',        description: 'Carpentry Contractors' },
  { code: '1761', macroName: 'Housing',        description: 'Roofing, Siding, Sheet Metal Contractors' },
  { code: '1771', macroName: 'Housing',        description: 'Concrete Work Contractors' },
  { code: '1799', macroName: 'Housing',        description: 'Special Trade Contractors (NEC)' },
  { code: '5200', macroName: 'Housing',        description: 'Home Supply Warehouse Stores' },
  { code: '5211', macroName: 'Housing',        description: 'Lumber and Building Materials Stores' },
  { code: '5251', macroName: 'Housing',        description: 'Hardware Stores' },
  { code: '5712', macroName: 'Housing',        description: 'Furniture, Home Furnishings, Equipment Stores' },
  { code: '5713', macroName: 'Housing',        description: 'Floor Covering Stores' },
  { code: '5714', macroName: 'Housing',        description: 'Drapery, Window Covering, Upholstery Stores' },
  { code: '5718', macroName: 'Housing',        description: 'Fireplace, Fireplace Screens, Accessories Stores' },
  { code: '5719', macroName: 'Housing',        description: 'Miscellaneous Home Furnishing Specialty Stores' },

  // ── Utilities ─────────────────────────────────────────────────────
  { code: '4814', macroName: 'Utilities',      description: 'Telecommunication Services' },
  { code: '4815', macroName: 'Utilities',      description: 'VisaPhone' },
  { code: '4821', macroName: 'Utilities',      description: 'Telegraph Services' },
  { code: '4899', macroName: 'Utilities',      description: 'Cable, Satellite, and Other Pay TV' },
  { code: '4900', macroName: 'Utilities',      description: 'Utilities - Electric, Gas, Water, Sanitary' },

  // ── Shopping ──────────────────────────────────────────────────────
  // 5200 (Home Supply Warehouse) is mapped under Housing above - seeding
  // uses INSERT OR IGNORE on (workspace, code), so a duplicate here would
  // be silently dead.
  { code: '5300', macroName: 'Shopping',       description: 'Wholesale Clubs' },
  { code: '5309', macroName: 'Shopping',       description: 'Duty Free Stores' },
  { code: '5310', macroName: 'Shopping',       description: 'Discount Stores' },
  { code: '5311', macroName: 'Shopping',       description: 'Department Stores' },
  { code: '5331', macroName: 'Shopping',       description: 'Variety Stores' },
  { code: '5399', macroName: 'Shopping',       description: 'Misc General Merchandise' },
  { code: '5611', macroName: 'Shopping',       description: "Men's and Boys' Clothing and Accessories Stores" },
  { code: '5621', macroName: 'Shopping',       description: "Women's Ready-To-Wear Stores" },
  { code: '5631', macroName: 'Shopping',       description: "Women's Accessory and Specialty Stores" },
  { code: '5641', macroName: 'Shopping',       description: "Children's and Infants' Wear Stores" },
  { code: '5651', macroName: 'Shopping',       description: 'Family Clothing Stores' },
  { code: '5655', macroName: 'Shopping',       description: 'Sports and Riding Apparel Stores' },
  { code: '5661', macroName: 'Shopping',       description: 'Shoe Stores' },
  { code: '5681', macroName: 'Shopping',       description: 'Furriers and Fur Shops' },
  { code: '5691', macroName: 'Shopping',       description: "Men's and Women's Clothing Stores" },
  { code: '5697', macroName: 'Shopping',       description: 'Tailors, Alterations' },
  { code: '5698', macroName: 'Shopping',       description: 'Wig and Toupee Stores' },
  { code: '5699', macroName: 'Shopping',       description: 'Miscellaneous Apparel and Accessory Shops' },
  { code: '5732', macroName: 'Shopping',       description: 'Electronics Stores' },
  { code: '5733', macroName: 'Shopping',       description: 'Music Stores, Musical Instruments, Pianos, Sheet Music' },
  { code: '5734', macroName: 'Shopping',       description: 'Computer Software Stores' },
  { code: '5735', macroName: 'Shopping',       description: 'Record Shops' },
  { code: '5815', macroName: 'Shopping',       description: 'Digital Goods: Media, Books, Movies, Music' },
  { code: '5816', macroName: 'Shopping',       description: 'Digital Goods: Games' },
  { code: '5817', macroName: 'Shopping',       description: 'Digital Goods: Applications (Excluding Games)' },
  { code: '5818', macroName: 'Shopping',       description: 'Digital Goods: Large Digital Goods Merchant' },
  { code: '5930', macroName: 'Shopping',       description: 'Antique Shops' },
  { code: '5931', macroName: 'Shopping',       description: 'Used Merchandise and Secondhand Stores' },
  { code: '5932', macroName: 'Shopping',       description: 'Antique Reproductions' },
  { code: '5933', macroName: 'Shopping',       description: 'Pawn Shops' },
  { code: '5940', macroName: 'Shopping',       description: 'Bicycle Shops' },
  { code: '5941', macroName: 'Shopping',       description: 'Sporting Goods Stores' },
  { code: '5942', macroName: 'Shopping',       description: 'Book Stores' },
  { code: '5943', macroName: 'Shopping',       description: 'Stationery, Office Supplies, Printing, Writing Paper' },
  { code: '5944', macroName: 'Shopping',       description: 'Jewelry, Watches, Clocks, Silverware Stores' },
  { code: '5945', macroName: 'Shopping',       description: 'Hobby, Toy, and Game Shops' },
  { code: '5946', macroName: 'Shopping',       description: 'Camera and Photographic Supply Stores' },
  { code: '5947', macroName: 'Shopping',       description: 'Gift, Card, Novelty and Souvenir Shops' },
  { code: '5948', macroName: 'Shopping',       description: 'Luggage and Leather Goods Stores' },
  { code: '5949', macroName: 'Shopping',       description: 'Sewing, Needlework, Fabric, and Piece Goods Stores' },
  { code: '5950', macroName: 'Shopping',       description: 'Glassware, Crystal Stores' },
  { code: '5964', macroName: 'Shopping',       description: 'Direct Marketing - Catalog Merchant' },
  { code: '5965', macroName: 'Shopping',       description: 'Direct Marketing - Combination Catalog and Retail' },
  { code: '5966', macroName: 'Shopping',       description: 'Direct Marketing - Outbound Tele' },
  { code: '5967', macroName: 'Shopping',       description: 'Direct Marketing - Inbound Tele' },
  { code: '5968', macroName: 'Shopping',       description: 'Direct Marketing - Continuity/Subscription' },
  { code: '5969', macroName: 'Shopping',       description: 'Direct Marketing - Other' },
  { code: '5970', macroName: 'Shopping',       description: "Artist's Supply and Craft Shops" },
  { code: '5971', macroName: 'Shopping',       description: 'Art Dealers and Galleries' },
  { code: '5973', macroName: 'Shopping',       description: 'Religious Goods Stores' },
  // 5975 (Hearing Aids) lives under Health & Medical below.
  { code: '5976', macroName: 'Shopping',       description: 'Orthopedic Goods' },
  { code: '5978', macroName: 'Shopping',       description: 'Typewriter Stores' },
  { code: '5983', macroName: 'Shopping',       description: 'Fuel Dealers (Non Automotive)' },
  { code: '5992', macroName: 'Shopping',       description: 'Florists' },
  { code: '5993', macroName: 'Shopping',       description: 'Cigar Stores and Stands' },
  { code: '5994', macroName: 'Shopping',       description: 'News Dealers and Newsstands' },
  { code: '5996', macroName: 'Shopping',       description: 'Swimming Pools Sales' },
  { code: '5997', macroName: 'Shopping',       description: 'Electric Razor Stores' },
  { code: '5998', macroName: 'Shopping',       description: 'Tent and Awning Shops' },
  { code: '5999', macroName: 'Shopping',       description: 'Miscellaneous and Specialty Retail Stores' },
  { code: '5192', macroName: 'Shopping',       description: 'Books, Periodicals, and Newspapers' },

  // ── Health & Medical ──────────────────────────────────────────────
  { code: '5912', macroName: 'Health & Medical', description: 'Drug Stores and Pharmacies' },
  { code: '5975', macroName: 'Health & Medical', description: 'Hearing Aids Sales' },
  { code: '8011', macroName: 'Health & Medical', description: 'Doctors - Not Elsewhere Classified' },
  { code: '8021', macroName: 'Health & Medical', description: 'Dentists, Orthodontists' },
  { code: '8031', macroName: 'Health & Medical', description: 'Osteopathic Physicians' },
  { code: '8041', macroName: 'Health & Medical', description: 'Chiropractors' },
  { code: '8042', macroName: 'Health & Medical', description: 'Optometrists, Ophthalmologist' },
  { code: '8043', macroName: 'Health & Medical', description: 'Opticians, Optical Goods, and Eyeglasses' },
  { code: '8049', macroName: 'Health & Medical', description: 'Podiatrists, Chiropodists' },
  { code: '8050', macroName: 'Health & Medical', description: 'Nursing/Personal Care' },
  { code: '8062', macroName: 'Health & Medical', description: 'Hospitals' },
  { code: '8071', macroName: 'Health & Medical', description: 'Medical and Dental Labs' },
  { code: '8099', macroName: 'Health & Medical', description: 'Medical Services' },

  // ── Entertainment ─────────────────────────────────────────────────
  { code: '7221', macroName: 'Entertainment',  description: 'Photographic Studios' },
  { code: '7333', macroName: 'Entertainment',  description: 'Commercial Photography, Art and Graphics' },
  { code: '7829', macroName: 'Entertainment',  description: 'Picture/Video Production' },
  { code: '7832', macroName: 'Entertainment',  description: 'Motion Picture Theaters' },
  { code: '7841', macroName: 'Entertainment',  description: 'DVD/Video Tape Rental Stores' },
  { code: '7911', macroName: 'Entertainment',  description: 'Dance Halls, Studios, Schools' },
  { code: '7922', macroName: 'Entertainment',  description: 'Theatrical Ticket Agencies' },
  { code: '7929', macroName: 'Entertainment',  description: 'Bands, Orchestras, Entertainers' },
  { code: '7932', macroName: 'Entertainment',  description: 'Billiard and Pool Establishments' },
  { code: '7933', macroName: 'Entertainment',  description: 'Bowling Alleys' },
  { code: '7941', macroName: 'Entertainment',  description: 'Commercial Sports, Athletic Fields' },
  { code: '7991', macroName: 'Entertainment',  description: 'Tourist Attractions and Exhibits' },
  { code: '7992', macroName: 'Entertainment',  description: 'Golf Courses - Public' },
  { code: '7993', macroName: 'Entertainment',  description: 'Video Amusement Game Supplies' },
  { code: '7994', macroName: 'Entertainment',  description: 'Video Game Arcades/Establishments' },
  { code: '7995', macroName: 'Entertainment',  description: 'Betting/Casino Gambling' },
  { code: '7996', macroName: 'Entertainment',  description: 'Amusement Parks, Carnivals, Circuses' },
  { code: '7998', macroName: 'Entertainment',  description: 'Aquariums, Dolphinariums, Zoos' },
  { code: '7999', macroName: 'Entertainment',  description: 'Recreation Services' },

  // ── Travel ────────────────────────────────────────────────────────
  { code: '3000', macroName: 'Travel',         description: 'Airlines - UNITED' },
  { code: '3001', macroName: 'Travel',         description: 'Airlines - AMERICAN AIRLINES' },
  { code: '3005', macroName: 'Travel',         description: 'Airlines - BRITISH AIRWAYS' },
  { code: '3007', macroName: 'Travel',         description: 'Airlines - AIR FRANCE' },
  { code: '3008', macroName: 'Travel',         description: 'Airlines - LUFTHANSA' },
  { code: '3009', macroName: 'Travel',         description: 'Airlines - AIR CANADA' },
  { code: '3010', macroName: 'Travel',         description: 'Airlines - KLM' },
  { code: '3011', macroName: 'Travel',         description: 'Airlines - AEROFLOT' },
  { code: '3012', macroName: 'Travel',         description: 'Airlines - QANTAS' },
  { code: '3013', macroName: 'Travel',         description: 'Airlines - ALITALIA' },
  { code: '3016', macroName: 'Travel',         description: 'Airlines - SAS' },
  { code: '3020', macroName: 'Travel',         description: 'Airlines - AIR INDIA' },
  { code: '3034', macroName: 'Travel',         description: 'Airlines - EGYPT AIR' },
  { code: '3058', macroName: 'Travel',         description: 'Airlines - DELTA' },
  { code: '3075', macroName: 'Travel',         description: 'Airlines - SINGAPORE AIRLINES' },
  { code: '3136', macroName: 'Travel',         description: 'Airlines - QATAR AIRWAYS' },
  { code: '3245', macroName: 'Travel',         description: 'Airlines - EASYJET' },
  { code: '3246', macroName: 'Travel',         description: 'Airlines - RYANAIR' },
  { code: '3299', macroName: 'Travel',         description: 'Airlines - OTHER' },
  { code: '3351', macroName: 'Travel',         description: 'Rental Car - AVIS' },
  { code: '3352', macroName: 'Travel',         description: 'Rental Car - HERTZ' },
  { code: '3357', macroName: 'Travel',         description: 'Rental Car - EUROPCAR' },
  { code: '3501', macroName: 'Travel',         description: 'Lodging - HOLIDAY INNS' },
  { code: '3509', macroName: 'Travel',         description: 'Lodging - MARRIOTT' },
  { code: '3511', macroName: 'Travel',         description: 'Lodging - SHERATON' },
  { code: '3512', macroName: 'Travel',         description: 'Lodging - HILTON' },
  { code: '3519', macroName: 'Travel',         description: 'Lodging - BEST WESTERN' },
  { code: '3530', macroName: 'Travel',         description: 'Lodging - IBIS' },
  { code: '3586', macroName: 'Travel',         description: 'Lodging - MOTEL 6' },
  { code: '3640', macroName: 'Travel',         description: 'Lodging - NOVOTEL' },
  { code: '3690', macroName: 'Travel',         description: 'Lodging - HOSTELS' },
  { code: '3999', macroName: 'Travel',         description: 'Lodging - OTHER' },
  { code: '4411', macroName: 'Travel',         description: 'Cruise Lines' },
  { code: '4457', macroName: 'Travel',         description: 'Boat Rentals and Leases' },
  { code: '4468', macroName: 'Travel',         description: 'Marinas, Marine Service, and Supplies' },
  { code: '4511', macroName: 'Travel',         description: 'Airlines, Air Carriers (generic)' },
  { code: '4582', macroName: 'Travel',         description: 'Airports, Airport Flying Fields' },
  { code: '4722', macroName: 'Travel',         description: 'Travel Agencies, Tour Operators' },
  { code: '7011', macroName: 'Travel',         description: 'Lodging - Hotels, Motels, Resorts' },
  { code: '7012', macroName: 'Travel',         description: 'Timeshares' },
  { code: '7032', macroName: 'Travel',         description: 'Sporting and Recreational Camps' },
  { code: '7033', macroName: 'Travel',         description: 'Trailer Parks, Campgrounds' },

  // -- Subscriptions (tiny category - most subs come through as digital goods) --
  { code: '4816', macroName: 'Subscriptions',  description: 'Computer Network/Information Services' },

  // ── Personal Care ─────────────────────────────────────────────────
  { code: '7230', macroName: 'Personal Care',  description: 'Barber and Beauty Shops' },
  { code: '7297', macroName: 'Personal Care',  description: 'Massage Parlors' },
  { code: '7298', macroName: 'Personal Care',  description: 'Health and Beauty Spas' },
  { code: '5977', macroName: 'Personal Care',  description: 'Cosmetic Stores' },

  // ── Education ─────────────────────────────────────────────────────
  { code: '8211', macroName: 'Education',      description: 'Elementary and Secondary Schools' },
  { code: '8220', macroName: 'Education',      description: 'Colleges, Universities, Professional Schools' },
  { code: '8241', macroName: 'Education',      description: 'Correspondence Schools' },
  { code: '8244', macroName: 'Education',      description: 'Business/Secretarial Schools' },
  { code: '8249', macroName: 'Education',      description: 'Vocational Schools and Trade Schools' },
  { code: '8299', macroName: 'Education',      description: 'Schools and Educational Services (NEC)' },

  // ── Financial Fees ────────────────────────────────────────────────
  { code: '6010', macroName: 'Financial Fees', description: 'Manual Cash Disbursements' },
  { code: '6011', macroName: 'Financial Fees', description: 'Automated Cash Disbursements (ATM)' },
  { code: '6012', macroName: 'Financial Fees', description: 'Financial Institutions - Merchandise and Services' },
  { code: '6051', macroName: 'Financial Fees', description: 'Non-Financial Institutions - Foreign Currency' },
  { code: '6211', macroName: 'Financial Fees', description: 'Security Brokers/Dealers' },
  { code: '9223', macroName: 'Financial Fees', description: 'Bail and Bond Payments' },

  // ── Insurance ─────────────────────────────────────────────────────
  { code: '6300', macroName: 'Insurance',      description: 'Insurance Sales, Underwriting, Premiums' },
  { code: '6381', macroName: 'Insurance',      description: 'Insurance Premiums' },
  { code: '6399', macroName: 'Insurance',      description: 'Insurance - Default' },

  // ── Gifts & Donations ─────────────────────────────────────────────
  { code: '8398', macroName: 'Gifts & Donations', description: 'Charitable and Social Service Organizations' },
  { code: '8661', macroName: 'Gifts & Donations', description: 'Religious Organizations' },
  { code: '8675', macroName: 'Gifts & Donations', description: 'Automobile Associations' },
  { code: '8699', macroName: 'Gifts & Donations', description: 'Membership Organizations (NEC)' },

  // ── Children & Family ─────────────────────────────────────────────
  { code: '8351', macroName: 'Children & Family', description: 'Child Care Services' },

  // ── Pets ──────────────────────────────────────────────────────────
  { code: '0742', macroName: 'Pets',           description: 'Veterinary Services' },
  { code: '5995', macroName: 'Pets',           description: 'Pet Shops, Pet Food, and Supplies' },

  // ── Taxes ─────────────────────────────────────────────────────────
  { code: '9311', macroName: 'Taxes',          description: 'Tax Payments' },
  { code: '9399', macroName: 'Taxes',          description: 'Government Services (NEC)' },

  // ── Miscellaneous (catch-all for professional services) ──────────
  { code: '7210', macroName: 'Miscellaneous',  description: 'Laundry, Cleaning, Garment Services' },
  { code: '7261', macroName: 'Miscellaneous',  description: 'Funeral Services and Crematories' },
  { code: '7273', macroName: 'Miscellaneous',  description: 'Dating/Escort Services' },
  { code: '7276', macroName: 'Miscellaneous',  description: 'Tax Preparation Service' },
  { code: '7277', macroName: 'Miscellaneous',  description: 'Counseling Services' },
  { code: '7278', macroName: 'Miscellaneous',  description: 'Buying/Shopping Services' },
  { code: '7296', macroName: 'Miscellaneous',  description: 'Clothing Rental - Costumes, Uniforms, Formal Wear' },
  { code: '7299', macroName: 'Miscellaneous',  description: 'Miscellaneous Personal Services' },
  { code: '7311', macroName: 'Miscellaneous',  description: 'Advertising Services' },
  { code: '7321', macroName: 'Miscellaneous',  description: 'Consumer Credit Reporting Agencies' },
  { code: '7338', macroName: 'Miscellaneous',  description: 'Quick Copy, Reproduction, and Blueprinting' },
  { code: '7339', macroName: 'Miscellaneous',  description: 'Stenographic and Secretarial Support' },
  { code: '7342', macroName: 'Miscellaneous',  description: 'Exterminating Services' },
  { code: '7349', macroName: 'Miscellaneous',  description: 'Cleaning and Maintenance Services' },
  { code: '7361', macroName: 'Miscellaneous',  description: 'Employment/Temp Agencies' },
  { code: '7372', macroName: 'Miscellaneous',  description: 'Computer Programming, Data Processing' },
  { code: '7379', macroName: 'Miscellaneous',  description: 'Computer Maintenance, Repair, Services' },
  { code: '7392', macroName: 'Miscellaneous',  description: 'Management, Consulting, PR Services' },
  { code: '7393', macroName: 'Miscellaneous',  description: 'Detective Agencies, Protective Services' },
  { code: '7394', macroName: 'Miscellaneous',  description: 'Equipment Rental and Leasing Services' },
  { code: '7395', macroName: 'Miscellaneous',  description: 'Photofinishing Labs, Photo Developing' },
  { code: '7399', macroName: 'Miscellaneous',  description: 'Business Services (NEC)' },
  { code: '8111', macroName: 'Miscellaneous',  description: 'Legal Services, Attorneys' },
  { code: '8911', macroName: 'Miscellaneous',  description: 'Architectural/Engineering/Surveying' },
  { code: '8931', macroName: 'Miscellaneous',  description: 'Accounting, Auditing, Bookkeeping Services' },
  { code: '8999', macroName: 'Miscellaneous',  description: 'Professional Services (NEC)' },
];
