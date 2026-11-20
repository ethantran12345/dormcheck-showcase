/**
 * Pitt arrival / move-in reference content, captured from arrival.pitt.edu
 * (packing-list, you-arrive, day-of-arrival) on 2026-06-24. Static guidance - 
 * update annually, as Pitt revises arrival details each year.
 */

export const ARRIVAL_LINKS = {
  myPitt: 'https://my.pitt.edu',
  microFridge: 'https://www.mymicrofridge.com/',
  ship2Pitt: 'https://www.pts.pitt.edu/mailing-services/ship2pitt',
} as const;

/** Downloadable arrival-day maps (bundled PDFs in /public). */
export const ARRIVAL_MAPS: { label: string; description: string; file: string }[] = [
  {
    label: 'Campus Arrival Map',
    description: 'Welcome stations, residence halls, unloading zones, parking, dining & recycling',
    file: '/pitt-campus-arrival-map.pdf',
  },
  {
    label: 'Arrival Quad Map',
    description: 'Resource & vendor tents in the Quad',
    file: '/pitt-arrival-quad-map.pdf',
  },
];

/** "Prepare for Pitt" resources & services (arrival.pitt.edu/you-arrive/prepare-pitt). */
export const PREPARE_RESOURCES: { label: string; description: string; href: string }[] = [
  { label: 'Panther Central', description: '24/7 help: housing, dining, Panther Card & funds', href: 'https://www.pc.pitt.edu/' },
  { label: 'Set up your Pitt email', description: 'Activate your Pitt email & account', href: 'https://services.pitt.edu/TDClient/33/Portal/KB/ArticleDet?ID=12' },
  { label: 'New Student Orientation', description: 'Required modules, videos & quizzes', href: 'https://www.orientation.pitt.edu/' },
  { label: 'Pitt Eats', description: 'Meal plans & dining locations', href: 'https://dineoncampus.com/pitt' },
  { label: 'PittPay', description: 'View & pay your university bill', href: 'http://payments.pitt.edu/' },
  { label: 'Financial Aid', description: 'Questions about financing your education', href: 'https://financialaid.pitt.edu/' },
  { label: 'Residence Life', description: 'Living on campus & connecting with your RA', href: 'https://www.studentaffairs.pitt.edu/reslife/' },
  { label: 'Disability Resources & Services', description: 'Accommodations & support', href: 'https://www.diversity.pitt.edu/disability-access/disability-resources-and-services' },
  { label: 'Office of International Services', description: 'Support for international students', href: 'https://www.ois.pitt.edu/office-international-services' },
];

/** How to view your housing assignment & meal membership. */
export const HOUSING_ASSIGNMENT_STEPS: string[] = [
  'Log in to my.pitt.edu (no "www" in front)',
  'Search for "Housing and Dining"',
  'Click "Housing and Dining Information"',
  'Go to the Housing Information section',
  'Click "View Your Assignment"',
];

export interface PackGroup {
  category: string;
  items: string[];
}

export const PACKING_LIST: PackGroup[] = [
  {
    category: 'School supplies',
    items: ['Notebooks & paper', 'Pens/pencils', 'Sticky notes', 'Stapler', 'Backpack', 'Calculator', 'Tape'],
  },
  {
    category: 'Room & furnishings',
    items: ['Pictures/posters', 'Hangers', 'Umbrella', 'Removable wall hooks', 'Command strips', 'Non-halogen lamp', 'Tool box', 'Full-length mirror', 'Slippers'],
  },
  {
    category: 'Bed & bath',
    items: ['Sheets (check your hall’s bed size)', 'Blanket/comforter', 'Pillows', 'Mattress pad (optional)', 'Shower caddy & shower shoes', 'Towels & wash cloths', 'Robe', 'Toiletries'],
  },
  {
    category: 'Kitchen',
    items: ['Reusable mug & water bottle', 'Microwave-safe bowls', 'Utensils', 'Small Brita', 'Reusable shopping bags'],
  },
  {
    category: 'Laundry & cleaning',
    items: ['Hamper/laundry bag', 'Detergent & dryer sheets', 'Drying rack', 'Disinfecting wipes', 'Paper towels', 'Dish soap', 'Cleaning spray', 'Private baths: toilet brush, cleaner & plunger'],
  },
  {
    category: 'Electronics & appliances',
    items: ['Laptop', 'TV (optional, 32" or smaller)', 'Gaming system (optional)', 'Surge-protector power strip', 'Fan', 'Microwave'],
  },
  {
    category: 'Health & safety',
    items: ['Acetaminophen / ibuprofen', 'Thermometer', 'Band-aids', 'First aid kit'],
  },
  {
    category: 'Documents',
    items: ['Mobile Panther ID', 'Driver’s license', 'ATM card', 'Social Security card', 'Insurance cards'],
  },
];

/**
 * Pitt-prohibited items ("What NOT to bring") now live in `skipAdvisories.ts`
 * as `banned: true` entries, surfaced in the checklist's "Leave these at home"
 * section alongside the soft skip advice - one place for everything to leave home.
 */

export const UNIVERSITY_PROVIDES: string[] = [
  'Per student: bed, desk & chair, dresser, closet/wardrobe',
  'Per room: cable TV (XFINITY on Campus), recycle & landfill bins',
  'Per hall: laundry facilities, vacuum cleaner',
];

export const WHAT_TO_EXPECT: { title: string; body: string }[] = [
  {
    title: 'Beat the heat',
    body: 'Pittsburgh summers get hot and moving in is strenuous. Pitt provides water (and maybe ice cream!), but bring your own bottle too. Watch the forecast and pack for rain.',
  },
  {
    title: 'Long lines & wait times',
    body: 'A lot of students move in at once. Lines to unload and for elevators are normal - please be patient with the team while they keep things moving.',
  },
  {
    title: 'Volunteers are everywhere',
    body: 'Student and staff volunteers are on hand to answer questions and help you move in. Don’t hesitate to ask if you need anything.',
  },
];

export const WELCOME_STATION_HOURS: { dates: string; time: string }[] = [
  { dates: 'Sat Aug 15 – Sun Aug 16, 2026', time: '8 a.m. – 8 p.m.' },
  { dates: 'Fri Aug 21 – Sat Aug 22, 2026', time: '9 a.m. – 5 p.m.' },
];

/** "Settling In" resources (arrival.pitt.edu/settling-in) - after you move in. */
export const SETTLING_IN_RESOURCES: { label: string; description: string; href: string }[] = [
  { label: 'Set up Wi-Fi (PittNet)', description: 'Connect your devices to campus Wi-Fi', href: 'https://services.pitt.edu/TDClient/33/Portal/KB/ArticleDet?ID=222' },
  { label: 'Panther Post (mail)', description: 'Your mailroom & package pickup', href: 'https://www.pts.pitt.edu/mailing-services/mail/pantherpost' },
  { label: 'Student Health', description: 'Health services & appointments', href: 'https://www.studentaffairs.pitt.edu/student-health-services' },
  { label: 'Campus Recreation', description: 'Gym, pool & facility hours', href: 'https://www.studentaffairs.pitt.edu/campus-recreation/facilities-hours' },
  { label: 'Getting around campus', description: 'Shuttles, transit & POGOH bikes', href: 'https://www.pts.pitt.edu/mobility' },
  { label: 'Sustainability', description: 'Recycling & green living on campus', href: 'https://www.bhas.pitt.edu/sustainability' },
  { label: 'University Stores', description: 'Textbooks, supplies & Pitt gear', href: 'https://www.bhas.pitt.edu/university-stores' },
];

/** Welcome Week 2026 (studentaffairs.pitt.edu/new-student-programs/welcome-week-2026). */
export const WELCOME_WEEK = {
  dates: 'Aug 17 – 23, 2026',
  scheduleUrl: 'https://experience.pitt.edu/home_login',
  intro:
    'A week of programs to help you learn about life at Pitt and meet your fellow new Panthers. See the full, live schedule on ExperiencePitt.',
  required: [
    'New Student Convocation - Mon Aug 17, 2–3 p.m. (Petersen Events Center)',
    'Class Photo - Mon Aug 17, 3–3:30 p.m. (Petersen Events Center)',
    'Residence Hall Floor Meetings - Mon Aug 17, 6 p.m. & 7:30 p.m.',
    'Building a Pitt Community - Tue Aug 18, 11 a.m.–12:30 p.m. (Petersen Events Center)',
    'Navigating Your Safety & Wellbeing - Tue Aug 18 (3 sessions, Soldiers & Sailors)',
    'Academic Program Meetings - Fri Aug 21, 8:30 a.m.–1 p.m.',
  ],
  highlights: [
    'Pep Rally & Drone Show - Wed Aug 19, 8 p.m. (Cathedral Lawn)',
    'Move on the Lawn: Legally Blonde - Wed Aug 19, 9:45 p.m.',
    'Pantherpalooza - Sat Aug 22, 8–11 p.m. (Cathedral Lawn)',
    'Involvement Fair - Sun Aug 23, 1–4 p.m. (Petersen Events Center)',
    'Lantern Night - Sun Aug 23, 7:15 p.m. (Cathedral Lawn)',
  ],
};

export interface Faq {
  q: string;
  a: string;
}

/** Arrival FAQs (arrival.pitt.edu/faqs), grouped by topic. */
export const MOVE_IN_FAQS: { category: string; items: Faq[] }[] = [
  {
    category: 'Move-in date & time',
    items: [
      { q: 'Will I get a specific move-in date and time?', a: 'Yes - you’ll receive one by Pitt email (and can view it online) to manage the volume of arrivals.' },
      { q: 'When will I get it?', a: 'In mid-July, in an email titled “Notice of Housing Assignment” to your Pitt email.' },
      { q: 'What if my assigned date doesn’t work?', a: 'Move in on one of the other designated Arrival days - no need to contact Panther Central.' },
      { q: 'Can upper-class students move in early?', a: 'Early move-ins before Aug 15 (not tied to a Pitt program) need prior approval from Panther Central.' },
    ],
  },
  {
    category: 'Panther Card (student ID)',
    items: [
      { q: 'Where do I get my ID photo taken?', a: 'No walk-ins - pre-submit your photo online before arrival.' },
      { q: 'How do I get my card?', a: 'If you pre-submitted on time, it’s mailed to your home address. If you missed it, pick it up at Panther Central (Litchfield Towers) before checking in.' },
    ],
  },
  {
    category: 'Parking',
    items: [
      { q: 'Can we bring more than one vehicle?', a: 'Only one Pitt Arrival parking pass is provided per student due to limited spaces.' },
      { q: 'Do I have to move my car after an hour?', a: 'Some locations require relocating to long-term parking after one hour so others can unload. Helpers can move the car and keep helping.' },
    ],
  },
  {
    category: 'Pitt Eats (dining)',
    items: [
      { q: 'When does my meal plan start?', a: 'August 15, 2026. Check Pitt Eats for Arrival-week hours.' },
      { q: 'Dining Dollars vs Panther Funds?', a: 'Dining Dollars come with your meal membership (participating vendors); Panther Funds are pre-loaded cash usable at many on- and off-campus spots.' },
      { q: 'Is there a grocery store on campus?', a: 'Yes - Forbes Street Market has fresh/prepared foods and pantry staples.' },
    ],
  },
  {
    category: 'Ship2Pitt',
    items: [
      { q: 'How many boxes can I ship?', a: 'Up to four boxes with four pre-paid labels, each no more than 50 lbs - delivered right to your room.' },
      { q: 'When’s the deadline?', a: 'The UPS portal opens June 30 (upperclass) / July 8 (first-years) and closes 11:59 p.m. July 23. Later boxes route through the mailroom with delays.' },
      { q: 'Do Amazon/Target boxes count?', a: 'No - retailer shipments don’t count toward your limit (they go to your mailroom).' },
    ],
  },
  {
    category: 'Getting around',
    items: [
      { q: 'When can I ride transit free?', a: 'Pittsburgh Regional Transit and Pitt Shuttles are free as soon as you move in. POGOH bikes are free for 30-minute rides.' },
      { q: 'What’s SafeRider?', a: 'A free evening/early-morning ride for non-emergency needs, up to 25 trips per semester.' },
    ],
  },
];

export const CHECKING_IN = {
  intro:
    'Find your welcome station, residence hall, unloading zones, long-term parking, dining locations, and recycling on Pitt’s Campus Arrival Map. Check in at your assigned Welcome Station.',
  carts:
    'Sign out one moving cart at a time for up to one hour. Show your Panther Card at your Welcome Station to scan a cart out, and return it there when you’re done to avoid charges.',
  wristbands:
    'All family members and helpers must wear a Pitt-issued wristband. Bring your guests to your assigned Welcome Station and show your Panther ID - guests then receive wristbands. Wristbands are only valid during scheduled Arrival dates/times; otherwise guests must sign in with a welcome attendant.',
} as const;
