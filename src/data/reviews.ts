// Real Google reviews of The Best Screen Printing & Embroidery, as customers wrote them
// (shortened only with an ellipsis). Names are shortened to a first name and last initial.
// No review markup on purpose: Google doesn't show self-published reviews as stars.
export interface Review { name: string; tag: string; text: string }

export const reviews: Review[] = [
  { name: 'John M.', tag: 'Tight deadline', text: 'Had a tight time line and TBSP came through for me like the pros they are. Great work product. Friendly people. Excellent combo' },
  { name: 'Tara J.', tag: 'Repeat customer', text: 'I have used this company on multiple occasions and they’ve done a wonderful job each time. They are the fastest vendor I’ve worked with as well, always willing to accommodate to meet our timeline.' },
  { name: 'Jules B.', tag: 'New clothing brand', text: 'Amazing service, Beautiful high quality clothing, I just opened my brand, and am very new to the clothing industry and they really helped me out in every way possible…' },
  { name: 'Meggan T.', tag: 'Detailed artwork', text: 'I needed something done fast from original, densely colored artwork, and the team… came through with flying colors! I recommend them for the flexibility, quick turnaround, and accommodating response.' },
  { name: 'Brian G.', tag: '200 company shirts', text: 'The sales rep. Amber helped me ordering 200 shirts for the company. She was patient and helpful and the shirts came 1 day earlier than expected.' },
  { name: 'Krysten W.', tag: 'Polos & hats', text: 'We have received our embroidered polo shirts and custom hats today and they came out perfectly! This company is awesome! Very professional! From the customer service to the production team.' },
  { name: 'Nicholas F.', tag: 'Rush order', text: 'They exceeded my expectations with the quality of their work and Steph was a delight through the entire process. Will absolutely be going back.' },
  { name: 'Lena D.', tag: 'Rush order', text: 'Asked them to rush my order and wow they delivered! Shirts were good quality, print was clear, and everyone absolutely loved how the shirts turned out!' },
];

export const reviewsUrl = 'https://www.google.com/search?q=The+Best+Screen+Printing+%26+Embroidery+Los+Angeles+reviews';
