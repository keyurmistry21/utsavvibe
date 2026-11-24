import { PrismaClient } from "@prisma/client";

// Pages, collections, menus and the pop-up that match the live utsavvibe.com site. Safe to run again: it only adds what is missing,
// and only sets the menus when they are still the defaults.
// usage: npm -w backend run seed:content
const prisma = new PrismaClient();

const pages: { handle: string; title: string; seoTitle: string; seoDescription: string; content: string }[] = [
  {
    handle: "about", title: "About Us", seoTitle: "About Utsav Vibe", seoDescription: "Learn about Utsav Vibe and our mission to bring festive joy through premium products.",
    content: `<h2>From missing homes to Utsav Vibes</h2>
<p>How one family's search for authentic festival items became Canada's and USA's celebration destination.</p>
<h3>Why we started Utsav Vibe</h3>
<p>Hi, I'm Pearl Mistry, and like so many Indians living in Canada, I faced the same frustrating problem every festival season. Walking through stores in Toronto and Mississauga, trying to find beautiful Ganesh murtis for Ganesh Chaturthi felt impossible. The rakhis available locally just didn't capture the love and tradition I wanted to share.</p>
<p>I remember standing in yet another store, looking at basic designs that cost a fortune, or finding items online with shipping costs from India that made my heart sink. That moment I realized - we deserve better. Our festivals deserve the same beauty, authenticity, and joy we remember from back home.</p>
<p>So I decided to change that. I reached out to skilled artisans in India, built relationships with trusted suppliers, and handpicked every single item that comes into our collection. From premium clay and paper mache Ganesh murtis to designer rakhis and beautiful festival decorations - everything at Utsav Vibes is chosen with the same care I'd use for my own family's celebrations.</p>
<p>Today, we're proud to serve Indian families across Ontario and beyond, bringing those authentic festival feelings right to your doorstep - or rather, to our warehouse where you can see everything in person.</p>
<h3>Why families choose Utsav Vibe</h3>
<ul>
<li><strong>Handpicked quality.</strong> Every murti, every rakhi, every decoration is personally selected for superior design and craftsmanship that you won't find in regular stores.</li>
<li><strong>Real relationships.</strong> We work directly with skilled Indian artisans who understand the sacred nature of what they're creating.</li>
<li><strong>Community understanding.</strong> We're part of the same community we serve. We know what it feels like to miss home during festivals.</li>
</ul>
<h3>What drives us every day</h3>
<p><strong>Creating festive vibes reminiscent of India.</strong> We believe every Indian family in Canada and the USA should have access to beautiful, authentic festival items without compromise. Whether you're celebrating Ganesh Chaturthi in Mississauga or Raksha Bandhan in Hamilton, we're here to make your celebrations feel just like the ones you grew up with.</p>
<h3>Meet Pearl Mistry</h3>
<p><em>Founder and heart of Utsav Vibe.</em> Pearl handles everything at Utsav Vibes - from sourcing authentic pieces in India to making sure every customer finds exactly what they're looking for. Her passion for preserving Indian traditions while building genuine community connections is what makes every interaction special. When she's not coordinating with artisans or planning city deliveries, you'll find her thinking about how to make the next festival season even better for our families.</p>`,
  },
  {
    handle: "contact", title: "Contact", seoTitle: "Contact Utsav Vibe", seoDescription: "Get in touch with Utsav Vibe for support, orders or inquiries.",
    content: `<h2>Get in touch</h2>
<p>Phone / WhatsApp: <a href="tel:4169046555">416-904-6555</a><br>Email: <a href="mailto:utsavvibe@gmail.com">utsavvibe@gmail.com</a></p>
<h3>Store locations</h3>
<ul>
<li>1985 Kipling Ave, Etobicoke, ON M9W 4J4, Canada</li>
<li>1939 Oak Tree Rd, Edison, NJ 08820, USA</li>
<li>298 Creekstone Hl SW, Calgary, AB T2X 5G4, Canada (note: online order only till August 10th)</li>
</ul>
<h3>Ontario cities we visit</h3>
<p>For orders of 10+ Ganesh murtis: Hamilton, Kitchener, Niagara Falls, London, Oshawa, Ottawa and Montreal.</p>`,
  },
  {
    handle: "faq", title: "FAQ", seoTitle: "Frequently asked questions | Utsav Vibe", seoDescription: "Pre-booking, pickup locations, sizes and payment for Utsav Vibe Ganesh idols and rakhis.",
    content: `<h2>Frequently asked questions</h2>
<h3>Are your Ganesh idols eco-friendly?</h3>
<p>Yes. All Utsav Vibe Ganesh idols are eco-friendly and crafted using environmentally conscious materials. Our idols are designed to support a respectful and traditional visarjan while minimizing environmental impact.</p>
<h3>When can I view the Ganesh idols in person?</h3>
<p>Our 2026 Ganesh idol collection will be available for viewing starting July 25, 2026. Customers are welcome to visit our warehouse by appointment to view available designs and select their preferred idol. As many designs are available in limited quantities, we recommend pre-booking early.</p>
<h3>Can I pre-book an idol before it arrives in Canada or the USA?</h3>
<p>Yes. Customers in both Canada and the United States can pre-book their preferred Ganesh idol before inventory becomes available by paying a 50% advance payment. Pre-booking helps secure popular designs before they sell out and guarantees availability once the collection becomes available.</p>
<h3>When can I pick up my pre-booked idol?</h3>
<p>Pickup for our 2026 Ganesh idol collection begins July 25, 2026. Customers who have pre-booked their idols will be contacted with pickup details and scheduling information.</p>
<h3>Can you hold an idol for me?</h3>
<p>Due to limited inventory and many designs being unique or limited-quantity pieces, we are unable to hold idols without a booking. To reserve an idol, a 50% advance payment is required.</p>
<h3>What sizes do you offer?</h3>
<p>Our Ganesh idol collection is available in 12", 15", 18" and 24". Availability varies by design and stock levels.</p>
<h3>Where are your pickup locations?</h3>
<p><strong>Canada.</strong> Primary pickup location: 1985 Kipling Ave Etobicoke, Ontario M9W 4J4. Pickup is by appointment only. We are also planning community pickup locations in Kitchener, Hamilton, Ottawa and Calgary, confirmed based on demand and logistics.</p>
<p><strong>United States.</strong> Customers in the United States can pick up their orders from our New Jersey pickup location during the Ganesh Chaturthi season. Pickup details and scheduling information will be shared closer to the season.</p>
<h3>Do you deliver to other cities?</h3>
<p>We do not offer shipping. However, based on customer demand, we may organize community pickup locations in select cities (Kitchener, Hamilton, Ottawa, Calgary, New Jersey). Availability depends on the number of orders received in each location.</p>
<h3>How can I pay for my order?</h3>
<p>Online payment, debit card, credit card or cash. Customers paying by cash may be eligible for special savings. Please contact us for details.</p>
<h3>Can I see the idol before purchasing?</h3>
<p>Yes. Customers are welcome to visit our Etobicoke location from July 25, 2026 onwards to view available idols. Visits are by appointment only.</p>
<h3>Do you provide shipping?</h3>
<p>No. Utsav Vibe does not currently offer shipping services. We focus on pickup and community pickup locations to ensure idols arrive safely.</p>
<h3>When should I pre-book my idol?</h3>
<p>We strongly recommend pre-booking as early as possible. Many of our designs are available in limited quantities, and some idols are one-of-a-kind pieces.</p>
<h3>Do you sell rakhi products as well?</h3>
<p>Yes. Utsav Vibe offers a curated Rakhi Collection featuring traditional rakhis, designer rakhis, and Bhaiya-Bhabhi sets. Quantities are limited and available while supplies last.</p>
<h3>How do I contact Utsav Vibe?</h3>
<p>Phone / WhatsApp: 416-904-6555. Our team is happy to assist with product availability, pre-booking, pickup scheduling, and general inquiries.</p>`,
  },
  {
    handle: "rakhi", title: "Rakhi", seoTitle: "Premium Rakhi Online Canada | Mississauga", seoDescription: "Handcrafted designer rakhis delivered across Ontario, Toronto and Vancouver.",
    content: `<h2>Celebrate the bond of love with premium rakhis in Canada</h2>
<p>Handcrafted designer rakhis for Ontario, Toronto and beyond. Browse <a href="/ca/collections/all-rakhi">all rakhis</a>, <a href="/ca/collections/all-rakhi?tag=couple+rakhi">couple rakhis (Bhai and Bhabhi)</a> and <a href="/ca/collections/all-rakhi?tag=brother+rakhi">brother rakhis</a>.</p>
<h3>Why choose Utsav Vibes</h3>
<p>Divine craftsmanship meets environmental consciousness: authentic Indian designs, premium quality materials, hand made, and a traditional festival experience.</p>
<h3>What our customers say</h3>
<blockquote>Finally found beautiful Ganesh murtis in Canada! The quality is amazing and the designs are so much better than what I've seen in other stores. - Success Ambaliya</blockquote>
<blockquote>I was worried about finding good rakhis for my brother here in Toronto. Utsav Vibes had exactly what I was looking for - traditional yet modern designs. The Bhaiya-Bhabhi set was perfect! - Hemant Patel</blockquote>
<blockquote>Been ordering from Utsav Vibes for Rakhi and Ganesh Chaturthi festivals. Pearl and her team really understand what we need as Indians living in Canada. The personal touch makes all the difference. - Keyur Mistry</blockquote>`,
  },
  {
    handle: "eco-friendly-ganesha", title: "Eco-friendly Ganesha", seoTitle: "Eco-Friendly Ganesh Idols for Canadian Homes 2026", seoDescription: "Pre-book handcrafted clay and paper mache Ganesh murtis for Ganesh Chaturthi 2026.",
    content: `<h2>Eco-friendly Ganesh idols for Canadian homes 2026</h2>
<p>Pre-book handcrafted clay and paper mache Ganesh murtis for Ganesh Chaturthi 2026. Available for Toronto pickup and Ontario delivery. <a href="/ca/collections/all-eco-friendly-ganesha-2026">Shop the collection</a>.</p>
<h3>Why choose Utsav Vibes</h3>
<p><strong>Divine craftsmanship meets environmental consciousness.</strong></p>
<ul>
<li><strong>Authentic materials:</strong> natural clay from sacred river banks, eco-friendly colors and decorations, a chemical-free production process.</li>
<li><strong>Traditional artistry:</strong> crafted by experienced artisans, following sacred proportions, detailed facial features, traditional mudras.</li>
<li><strong>Environmental commitment:</strong> 100% eco-friendly materials, natural dissolving properties, zero harmful chemicals, sustainable packaging.</li>
</ul>
<h3>Eco-friendly visarjan guide</h3>
<p><em>A thoughtful farewell to Lord Ganesha.</em> Experience a simple and meaningful visarjan at home:</p>
<ol>
<li>Prepare a water-filled vessel with flowers and natural elements.</li>
<li>Conduct Ganesh Arti and offer sweets.</li>
<li>Submerge the idol gently, praying for blessings until next year. Celebrate sustainably and keep our waters clean.</li>
</ol>`,
  },
];

const collections = [
  { handle: "all-rakhi", title: "All Rakhi", tag: "rakhi" },
  { handle: "all-ganesha-2026", title: "All Ganesha 2026", tag: "ganesha" },
  { handle: "all-eco-friendly-ganesha-2026", title: "All Eco Friendly Ganesha 2026", tag: "ganesha" },
];

const sizes = ["12", "15", "18", "21", "24", "30"];
const headerMenu = [
  { label: "Home", url: "/" },
  { label: "Rakhi", url: "/pages/rakhi", children: [
    { label: "All rakhis", url: "/collections/all-rakhi" },
    { label: "Couple rakhi collections (Bhai & Bhabhi)", url: "/collections/all-rakhi?tag=couple+rakhi" },
    { label: "Brother rakhi", url: "/collections/all-rakhi?tag=brother+rakhi" },
  ] },
  { label: "Eco-Friendly Ganesha", url: "/pages/eco-friendly-ganesha", children: [
    { label: "All Eco Friendly Ganesha 2026", url: "/collections/all-eco-friendly-ganesha-2026" },
    { label: "Premium Eco-friendly Idols", url: "/collections/all-ganesha-2026?tag=premium+ganesha" },
    ...sizes.map((n) => ({ label: `${n} Inch`, url: `/collections/all-ganesha-2026?size=${n}+inch` })),
  ] },
  { label: "FAQ", url: "/pages/faq" },
  { label: "About Us", url: "/pages/about" },
  { label: "Contact", url: "/pages/contact" },
];
const footerMenu = [
  { label: "Home", url: "/" }, { label: "About Us", url: "/pages/about" }, { label: "FAQ", url: "/pages/faq" }, { label: "Contact Us", url: "/pages/contact" },
];
const popup = { enabled: true, title: "🙏 Happy Ganesh Chaturthi! 🙏", text: "May Lord Ganesha bless you and your family with happiness, peace, prosperity, and success.\n\nThank you for celebrating this beautiful festival with Utsav Vibe and for your incredible love and support. ❤️\n\nWishing you a joyful and blessed Ganesh Chaturthi!\n\nTeam Utsav Vibe" };

async function main() {
  for (const p of pages) {
    if (!(await prisma.page.findUnique({ where: { handle: p.handle } }))) { await prisma.page.create({ data: p }); console.log("page", p.handle); }
  }
  for (const c of collections) {
    if (!(await prisma.collection.findUnique({ where: { handle: c.handle } }))) {
      await prisma.collection.create({ data: { handle: c.handle, title: c.title, description: "", kind: "smart", rules: JSON.stringify({ match: "all", conditions: [{ field: "tag", op: "is", value: c.tag }] }) } });
      console.log("collection", c.handle);
    }
  }
  const row = await prisma.setting.findUnique({ where: { key: "onlineStore" } });
  const cur = row ? JSON.parse(row.value) : {};
  const isDefault = !cur.headerMenu || (cur.headerMenu.length === 1 && cur.headerMenu[0].label === "Shop");
  if (isDefault) {
    const next = { ...cur, headerMenu, footerMenu: cur.footerMenu?.length ? cur.footerMenu : footerMenu, ...(cur.popup ? {} : { popup }) };
    await prisma.setting.upsert({ where: { key: "onlineStore" }, create: { key: "onlineStore", value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    console.log("menus + popup set");
  }
}
main().finally(() => prisma.$disconnect());
