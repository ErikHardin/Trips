const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function df(iso) { const [y,m,d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y,m-1,d)); return { dateISO: iso, dateNum: String(d), dateMonth: M[m-1], dayName: WD[dt.getUTCDay()] }; }
function addDays(iso, n) { const [y,m,d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y,m-1,d+n)); return dt.toISOString().slice(0,10); }
function mkDays(start, specs) {
  const days = {};
  specs.forEach((s, i) => {
    const acts = (s.acts || []).map((a, j) => ({ key: 'a' + j, ...(typeof a === 'string' ? { text: a } : a) }));
    days['d' + String(i).padStart(2,'0')] = { ...df(addDays(start, i)), city: s.city, hotel: s.hotel || '', region: s.region, regionColor: s.color, description: s.desc || '', activities: acts, sortOrder: i, ...(s.extra || {}) };
  });
  return days;
}
const now = Date.parse('2026-09-28T12:00:00Z');
const portugal = {
  name: 'Portugal Fall 2026', year: 2026, dates: 'Sep 24 – Oct 2', emoji: '🇵🇹', status: 'active', startDateISO: '2026-09-24', currency: '€',
  flightOut: 'UA 940 DEN → LIS 5:10pm – 9:25am', flightOutDate: 'Sep 23', flightReturn: 'TP 205 LIS → EWR 10:30am – 1:15pm\nUA 1123 EWR → DEN 4:05pm – 6:20pm', flightReturnDate: 'Oct 2',
  days: mkDays('2026-09-24', [
    { city: 'Lisbon', region: 'Lisbon', color: '#c06a3d', hotel: 'Memmo Príncipe Real', desc: 'Arrival day', acts: [{ text: 'Land at LIS', time: '9:25am', emoji: '🛬' }, { text: 'Lunch at Cervejaria Ramiro', time: '1pm', bookingStatus: 'walking_in' }, { text: 'Sunset at Miradouro da Senhora do Monte', time: '7pm' }], extra: { dailySpend: 212 } },
    { city: 'Lisbon', region: 'Lisbon', color: '#c06a3d', hotel: 'Memmo Príncipe Real', desc: 'Alfama & Belém', acts: [{ text: 'Walking tour of Alfama', time: '10am', bookingStatus: 'paid' }, { text: 'Pastéis de Belém', time: '2pm' }, { text: 'Dinner at Belcanto', time: '8pm', michelin: true, bookingStatus: 'booked' }], extra: { dailySpend: 486 } },
    { city: 'Sintra', region: 'Lisbon', color: '#c06a3d', hotel: 'Memmo Príncipe Real', desc: 'Day trip to Sintra', acts: [{ text: 'Pena Palace', time: '9:30am', bookingStatus: 'paid' }, { text: 'Quinta da Regaleira', time: '1pm' }, { text: 'Dinner at Taberna da Rua das Flores', time: '8pm', bookingStatus: 'walking_in' }], extra: { dailySpend: 301 } },
    { city: 'Lisbon', region: 'Lisbon', color: '#c06a3d', hotel: 'Memmo Príncipe Real', desc: 'LX Factory & Tile Museum', acts: [{ text: 'National Tile Museum', time: '10am' }, { text: 'LX Factory market', time: '1pm' }, { text: 'Fado night at Clube de Fado', time: '9pm', bookingStatus: 'booked' }] },
    { city: 'Évora', region: 'Alentejo', color: '#6d9b72', hotel: 'São Lourenço do Barrocal', desc: 'Drive to Alentejo', acts: [{ text: 'Pick up rental car', time: '9am', emoji: '🚗', bookingStatus: 'paid' }, { text: 'Chapel of Bones, Évora', time: '12pm', drive: true }, { text: 'Wine tasting at Herdade do Esporão', time: '4pm', bookingStatus: 'booked' }] },
    { city: 'Monsaraz', region: 'Alentejo', color: '#6d9b72', hotel: 'São Lourenço do Barrocal', desc: 'Slow day at the farm', acts: [{ text: 'Horseback ride', time: '9am', bookingStatus: 'not_booked' }, { text: 'Explore Monsaraz village', time: '3pm' }] },
    { city: 'Gaia', region: 'Porto', color: '#4a7fb5', hotel: 'The Yeatman', desc: 'Drive north to Porto', acts: [{ text: 'Drive to Porto', time: '10am', emoji: '🚗', drive: true }, { text: 'Port tasting at Graham’s', time: '4pm', bookingStatus: 'booked' }] },
    { city: 'Gaia', region: 'Porto', color: '#4a7fb5', hotel: 'The Yeatman', desc: 'Douro Valley', acts: [{ text: 'Douro Valley river cruise', time: '9am', bookingStatus: 'paid' }, { text: 'Dinner at The Yeatman', time: '8pm', michelin: true, bookingStatus: 'booked' }] },
    { city: 'Lisbon', region: 'Porto', color: '#4a7fb5', hotel: '', desc: 'Fly home', acts: [{ text: 'Train to Lisbon airport', time: '6am', emoji: '🚆' }] },
  ]),
  logistics: {
    flightsBooked: true, hotelsBooked: true, carRentalBooked: false,
    packingList: [
      { person: 'Erik', sections: [{ title: 'Documents', items: [{ id: 'p1', label: 'Passport', checked: true }, { id: 'p2', label: 'Driver’s license', checked: true }] }, { title: 'Clothes', items: [{ id: 'p3', label: 'Walking shoes', checked: true }, { id: 'p4', label: 'Rain jacket', checked: false }] }] },
      { person: 'Sarah', sections: [{ title: 'Documents', items: [{ id: 'p5', label: 'Passport', checked: true }] }, { title: 'Electronics', items: [{ id: 'p6', label: 'EU plug adapter', checked: false }, { id: 'p7', label: 'Camera', checked: true }] }] },
    ],
  },
  wishlist: {
    w1: { emoji: '🍷', text: 'Quinta do Crasto', notes: 'Douro winery with the infinity pool', createdBy: 'Sarah', createdAt: now - 9e8 },
    w2: { emoji: '🏄', text: 'Surf lesson in Nazaré', notes: 'Maybe on the drive north?', createdBy: 'Erik', createdAt: now - 5e8 },
    w3: { emoji: '📚', text: 'Livraria Lello', notes: 'Book timed tickets online', createdBy: 'Sarah', createdAt: now - 1e8 },
  },
  changeLog: {
    c1: { action: 'Updated activity', detail: 'Dinner at Belcanto → 8pm', user: 'Erik', ts: now - 3.6e6 * 30 },
    c2: { action: 'Added activity', detail: 'Fado night at Clube de Fado (Sep 27)', user: 'Sarah', ts: now - 3.6e6 * 8 },
    c3: { action: 'Booking status', detail: 'Wine tasting at Herdade do Esporão → Booked', user: 'Erik', ts: now - 3.6e6 * 2 },
  },
};
// Notes on an activity
portugal.days.d01.notes = { a2: { n1: { text: 'Best meal of the trip so far. Get the tasting menu with the wine pairing — worth it.', ts: now - 3.6e6 * 60, author: 'Erik' }, n2: { text: 'Ask for a table by the window.', ts: now - 3.6e6 * 50, author: 'Sarah' } } };
portugal.days.d01.recommended = { a2: true };

const japan = {
  name: 'Japan Spring 2027', year: 2027, dates: 'Mar 28 – Apr 8', emoji: '🇯🇵', status: 'upcoming', startDateISO: '2027-03-28',
  days: mkDays('2027-03-28', [
    { city: 'Tokyo', region: 'Tokyo', color: '#c45c7a', hotel: 'Park Hyatt Tokyo', acts: ['Arrive at Haneda', 'Ramen in Shinjuku'] },
    { city: 'Tokyo', region: 'Tokyo', color: '#c45c7a', hotel: 'Park Hyatt Tokyo', acts: ['Tsukiji Outer Market', 'teamLab Planets'] },
    { city: 'Kyoto', region: 'Kyoto', color: '#8a6aad', hotel: 'Hoshinoya Kyoto', acts: ['Shinkansen to Kyoto', 'Fushimi Inari'] },
  ]),
};
const france = {
  name: 'France Spring 2026', year: 2026, dates: 'May 24 – Jun 4', emoji: '🇫🇷', status: 'past', startDateISO: '2026-05-24',
  days: mkDays('2026-05-24', [
    { city: 'Lyon', region: 'Lyon', color: '#c06a3d', hotel: 'InterContinental Lyon Hotel Dieu', acts: ['Wine at Octopus', 'Les Halles Paul Bocuse'] },
    { city: 'Annecy', region: 'Alps', color: '#6d9b72', hotel: 'Les Trésoms', acts: ['Lake cruise'] },
    { city: 'Paris', region: 'Paris', color: '#4a7fb5', hotel: 'Le Pavillon de la Reine', acts: ['Musée d’Orsay'] },
  ]),
};
const iceland = { name: 'Iceland Ring Road', year: 2025, dates: 'Jul 5 – Jul 14', emoji: '🇮🇸', status: 'past', startDateISO: '2025-07-05',
  days: mkDays('2025-07-05', [{ city: 'Reykjavik', region: 'Reykjavik', color: '#4a7fb5', hotel: 'Hotel Borg', acts: ['Blue Lagoon'] }, { city: 'Vík', region: 'South Coast', color: '#6d9b72', hotel: 'Hotel Vík', acts: ['Reynisfjara beach'] }]) };

module.exports = (adminEmail) => ({
  config: { appName: 'Hardin', bookingInboxAddress: 'trips@hardintrips.com', bookingInboxSenders: { 'sarah,personal@yahoo,com': { email: 'sarah.personal@yahoo.com' } } },
  geocache: Object.fromEntries(Object.entries({ lisbon:[38.7223,-9.1393], sintra:[38.8029,-9.3817], _vora:[38.5714,-7.9135], monsaraz:[38.4431,-7.3806], porto:[41.1579,-8.6291], gaia:[41.1336,-8.6174], tokyo:[35.6762,139.6503], kyoto:[35.0116,135.7681], lyon:[45.764,4.8357], annecy:[45.8992,6.1294], paris:[48.8566,2.3522], reykjavik:[64.1466,-21.9426], v_k:[63.4186,-19.006] }).map(([k,[lat,lng]]) => [k, { lat, lng, v: 3 }])),
  access: {
    [adminEmail.replace(/\./g, ',')]: { role: 'admin', name: 'Erik', email: adminEmail, lastOutstandingPopupAt: Date.now() },
    'sarah@example,com': { role: 'admin', name: 'Sarah', email: 'sarah@example.com', lastLogin: now - 3.6e6 * 5 },
    'grandma@example,com': { role: 'guest', name: 'Grandma', email: 'grandma@example.com', trips: { portugal: true }, lastLogin: now - 8.64e7 * 3 },
    'alex@example,com': { role: 'user', name: 'Alex', email: 'alex@example.com', trips: { portugal: true, japan: true }, lastLogin: now - 8.64e7 * 10 },
  },
  trips: { portugal, japan, france, iceland },
  bookingInbox: {
    b1: { receivedAt: now - 3.6e6 * 2, from: 'sarah@example.com', subject: 'Fwd: Your ANA flight confirmation', source: 'email', status: 'pending', kind: 'flight',
      summary: 'ANA · DEN → HND, KIX → DEN',
      parsed: { flights: [
        { flightNumber: 'NH 11', from: 'DEN', to: 'HND', dateISO: '2027-03-27', depTime: '12:40', arrTime: '16:05', confirmation: 'K7QZ4M' },
        { flightNumber: 'NH 10', from: 'KIX', to: 'DEN', dateISO: '2027-04-08', depTime: '17:30', arrTime: '13:10', confirmation: 'K7QZ4M' },
      ] } },
    b2: { receivedAt: now - 3.6e6 * 20, from: 'erikchardin@gmail.com', subject: 'Reservation confirmed: Sushi Saito', source: 'email', status: 'pending', kind: 'activity',
      summary: 'Dinner at Sushi Saito · Mar 29',
      parsed: { activities: [{ title: 'Dinner at Sushi Saito', venue: 'Sushi Saito', dateISO: '2027-03-29', time: '7:30pm', partySize: 2, paid: false, confirmation: 'OMK-2219' }] } },
    b3: { receivedAt: now - 8.64e7 * 2, from: 'erikchardin@gmail.com', subject: 'Fwd: Hoshinoya Kyoto booking', source: 'email', status: 'assigned', assignedTripId: 'japan', assignedAt: now - 8.64e7 * 0.5, kind: 'hotel',
      summary: 'Hoshinoya Kyoto · Mar 30 – Apr 2', parsed: { hotels: [{ name: 'Hoshinoya Kyoto', city: 'Kyoto', checkInISO: '2027-03-30', checkOutISO: '2027-04-02' }] } },
  },
  travelTracker: {
    2026: { trips: { t1: { name: 'Portugal', dates: 'Sep 24 – Oct 2', flights: 'booked', hotel: 'booked', car: 'booked' }, t2: { name: 'Thanksgiving in Austin', dates: 'Nov 25 – 29', flights: 'booked', hotel: '', car: 'na' } } },
    2027: { trips: { t3: { name: 'Japan', dates: 'Mar 28 – Apr 8', flights: 'booked', hotel: '', car: 'na' }, t4: { name: 'Italy', dates: 'May 10 – 20', flights: '', hotel: '', car: '' } } },
  },
});
