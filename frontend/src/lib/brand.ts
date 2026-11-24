// Storefront copy and images ported from the Shopify theme (my-shopify-theme). Edit here to change the home page.
export const brand = {
  name: "Utsav Vibe",
  phone: "416-904-6555",
  phoneHref: "tel:4169046555",
  email: "utsavvibe@gmail.com",
  instagram: "https://www.instagram.com/uutsavvibe/",
  whatsapp: "https://wa.me/c/14169046555",
  addresses: [
    { lines: ["1985 Kipling Ave,", "Etobicoke,", "ON M9W 4J4, Canada"] },
    { lines: ["1939 Oak Tree Rd,", "Edison,", "NJ 08820, USA"] },
    { lines: ["298 Creekstone Hl SW,", "Calgary,", "AB T2X 5G4, Canada"], note: "Note: online order only till august 10th" },
  ],
  copyright: "Celebrating tradition, one festival at a time.",
};

export const heroSlides = [
  { image: "/theme/eco-friendly-clay-ganesha-idol-toronto-canada.webp", alt: "Eco-friendly clay Ganesha idol handcrafted for Ganesh Chaturthi", sub: "Ganpati Bappa Morya!", title: ["Premium Eco-Friendly Ganesh", "Idols in Canada & the USA"] as [string, string], text: "Ghar mein Bappa ka swagat kijiye. Handcrafted premium eco-friendly Ganesh idols (murtis) for Ganesh Chaturthi. Available in 12\", 15\", 18\", 21\" & 24\" sizes with shringar.", button: "Pre-Book Your Idol", href: "/collections/all-ganesha-2026" },
  { image: "/theme/clay-ganpati-bappa-idols-newyork.webp", alt: "Handmade clay Ganpati Bappa idols", sub: "Welcome Ganpati Bappa with", title: ["Mangal", "murti"] as [string, string], text: "This Ganesh Chaturthi, bring home idols that reflect tradition, artistry, and eco-consciousness. Handcrafted with devotion, delivered with love across Ontario and Montreal.", button: "Find Your Ganesha", href: "/collections/all-eco-friendly-ganesha-2026" },
  { image: "/theme/shadumati-clay-ganesha-murti-usa-canada.webp", alt: "Shadumati clay Ganesha murti", sub: "Raksha Bandhan 2026", title: ["Designer", "Rakhi Collection"] as [string, string], text: "Strengthen bonds with beautiful rakhis and Bhaiya-Bhabhi sets - traditional to premium designs, available in limited pieces.", button: "Shop Rakhis", href: "/collections/all-rakhi" },
];

export const prebook = {
  title: ["Pre-Book", "for Upcoming Festivals"],
  text: "Limited quantities available - mostly single piece items, reserve yours today!",
  cards: [
    { image: "/theme/ladoo_ganesha_ontario_canada.webp", title: "Ganesh Idols (10”–24”)", text: "Premium eco-friendly Ganesha designs", button: "Pre-Book Ganesh Idol", href: "/collections/all-ganesha-2026" },
    { image: "/theme/rakhi_toronto_canada.webp", title: "Rakhi Collection", text: "Designer rakhis & Bhaiya-Bhabhi sets—limited pieces available.", button: "Shop Rakhis", href: "/collections/all-rakhi" },
  ],
};

export const why = {
  title: ["What Makes", "Utsav Vibe", "Special"],
  sub: "Quality, tradition, and care in every Ganesh idol",
  text: "At Utsav Vibe, we’re passionate about bringing home celebrations to Canada & USA with premium designs crafted with devotion:",
  items: [
    { image: "/theme/hand-mad.webp", title: "Authentic Artistry", text: "Handcrafted with care—each idol reflects timeless craftsmanship." },
    { image: "/theme/sustainable-livin.webp", title: "Eco-Conscious", text: "Made with biodegradable materials and traditional finishing for respectful visarjan." },
    { image: "/theme/cultural-diversit.webp", title: "Culturally Inspired", text: "Designed to align with rituals and bring blessings to your home." },
  ],
};

export const showcases = [
  { reverse: true, tint: true, small: "2026", title: ["Ganesha Idol", "Collection"], text: "Our collection features handpicked Eco-friendly Ganesh idols (murtis) with premium designs you won’t find elsewhere. Crafted by skilled artisans with beautiful detailing, imported from Mumbai, available in 12”, 15”, 18” & 24” sizes. Now Available in Canada and the USA", button: "Shop Ganesh Idols", href: "/collections/all-ganesha-2026", images: ["/theme/eco-friendly-dagdusheth-halwai-ganesha-idol-24-inch.webp", "/theme/eco-friendly-lalbaugh-cha-raja-ganesh-murti-canada.webp", "/theme/eco-friendly-ashta-vinayak-ganesha-idol-24-inch-yellow-red.webp"] },
  { reverse: false, tint: false, small: "2026", title: ["Rakhi", "Collection"], text: "Strengthen bonds with beautiful rakhis and Bhaiya-Bhabhi sets—traditional to premium designs, available in limited pieces.", button: "Shop Rakhis", href: "/collections/all-rakhi", images: ["/theme/couple_rakhi-pink-white.webp", "/theme/couple_rakhi-red-mina.webp", "/theme/couple_rakhi-purple-mina.webp"] },
];

export const family = { title: ["Join the", "Utsav Vibe Family"], text: "Share your Ganesh Chaturthi moments and connect with our community across Canada & USA. Tag us to get featured.", button: "Follow on Instagram" };
export const celebrate = { title: "Ready to Celebrate?", text: "Browse our complete collection of premium festival essentials", button: "Shop Now", href: "/collections/all-ganesha-2026" };

export const testimonials = {
  title: ["What Our Customers", "Say"],
  text: "Real stories from our Utsav Vibes family",
  items: [
    { quote: "Finally found beautiful Ganesh murtis in Canada! The quality is amazing and the designs are so much better than what I've seen in other stores.", author: "Success Ambaliya" },
    { quote: "I was worried about finding good rakhis for my brother here in Toronto. Utsav Vibes had exactly what I was looking for - traditional yet modern designs. The Bhaiya-Bhabhi set was perfect!", author: "Hemant Patel" },
    { quote: "The decorations transformed our home completely. The torans and diya holders made our festival celebration feel just like back home in India. Great quality and fast service.", author: "Nitin Patel" },
  ],
};

export const faq = {
  title: ["Frequently", "Asked Questions"],
  text: "Everything you need to know about ordering from Utsav Vibe",
  items: [
    { q: "Where is your pickup location?", a: "Pickup is available at 1985 Kipling Ave Etobicoke, Ontario M9W 4J4 (appointment only). You can book a time to view and pick up your order during the season." },
    { q: "Do you deliver to other cities in Ontario (or outside Ontario)?", a: "We primarily offer pickup in Etobicoke. For 50+ item bulk orders we can arrange delivery across Canada. Contact us to confirm." },
    { q: "What sizes do you offer for Ganesh idols (murtis)?", a: "We offer 10”, 12”, 15”, 18” & 24” sizes. Designs and availability vary by size." },
    { q: "Do you provide shipping?", a: "Shipping depends on your market and order size. Rates and free-shipping thresholds are shown in your cart before you pay." },
    { q: "When should I place my pre-booking?", a: "As early as possible. Most designs are single pieces and sell out before Ganesh Chaturthi." },
    { q: "What materials are your Ganesh idols made from?", a: "Eco-friendly clay with biodegradable finishing, made for a respectful visarjan at home." },
    { q: "Can I see the idols before purchasing?", a: "Yes. Visit us at a pickup location by appointment to view the idols in person." },
  ],
};
