// Brightdesk marketing site bundle (client-only render).
// Every route is decided here, after JavaScript runs. Unknown routes,
// including /pricing, render a client-side "404" while the server says 200.

const NAV = [
  ["/", "Home"],
  ["/pricing", "Pricing"],
  ["/integrations", "Integrations"],
  ["/blog", "Blog"],
];

const HOME = {
  h1: "The shared inbox for support teams of 2 to 20",
  lede:
    "Brightdesk brings your support email, website chat and WhatsApp Business messages into one shared inbox. Every conversation has an owner, a status and a due time, so nothing slips through and no customer gets two different answers from two different people. Most teams are live in an afternoon, without a consultant and without a six-week onboarding project.",
  sections: [
    {
      h2: "Why small teams outgrow a shared Gmail account",
      body: [
        "A shared Gmail or Outlook mailbox works until it does not. Two people reply to the same customer. A refund request sits unread over a weekend because everyone assumed someone else had it. Nobody can say how long customers wait for a first reply, and the only report is a feeling that things are busy. Brightdesk keeps the familiar inbox layout and adds the parts a mailbox is missing: assignment, collision detection, internal notes, statuses and service-level targets.",
        "Collision detection shows when a teammate is already typing a reply, so you never send a duplicate. Internal notes let you ask a colleague a question inside the conversation instead of forwarding the thread to yourself with a sticky note. Statuses such as open, waiting on customer and resolved replace the habit of starring and un-starring messages.",
      ],
    },
    {
      h2: "One inbox for every channel your customers already use",
      body: [
        "Connect a support address in under five minutes by forwarding mail or by signing in with Google Workspace or Microsoft 365. Add the website chat widget with one script tag. Connect a WhatsApp Business number through the official cloud API, so messages arrive in the same list as email, with the same owner and the same due time.",
        "Customers do not care which channel your team prefers. When a customer emails on Monday and messages on WhatsApp on Tuesday, Brightdesk links both conversations to one contact record, so the person who picks up the second message can see the first without asking the customer to repeat themselves.",
      ],
    },
    {
      h2: "Service-level targets that the whole team can see",
      body: [
        "Set a first-reply target and a resolution target per inbox, per channel or per customer tag. Brightdesk counts business hours only, using the opening hours and public holidays you set for each team. Conversations close to breaching move to the top of the list and turn amber, then red. A daily summary email shows how many targets were met yesterday and which conversations missed.",
        "Targets are not there to punish anyone. They make the workload visible, so a team lead can see on a Tuesday morning that the billing inbox needs a second person, rather than finding out from an angry review on Friday.",
      ],
    },
    {
      h2: "Saved replies, macros and a help centre that writes itself",
      body: [
        "Saved replies hold the answers your team types every day, with placeholders for the customer's name, order number or plan. Macros go further: one click can apply a reply, set a tag, change the status and assign the conversation to the right person. When the same question arrives ten times in a week, Brightdesk suggests turning the best reply into a help centre article.",
        "The help centre is hosted on your own subdomain, uses your colours and logo, and supports articles in several languages. Each article shows how many conversations it deflected last month, so you can tell which pages are pulling their weight and which ones customers ignore.",
      ],
    },
    {
      h2: "Reporting that answers the questions owners actually ask",
      body: [
        "How many conversations did we handle last week? How long did customers wait for a first reply? Which topics are growing? Who on the team is carrying the most work? The reports page answers each of these on one screen, with filters for channel, tag and teammate. Every chart can be exported as a CSV file for your own spreadsheets.",
        "Customer satisfaction surveys are optional. When they are switched on, every customer gets the same one-question survey after a conversation is resolved, and the results show next to the conversation that prompted them, so a low score leads straight to the context.",
      ],
    },
    {
      h2: "How setup works",
      body: [
        "Day one starts with your support address. Forward it or connect the mailbox, invite your teammates and choose who owns which inbox. Brightdesk imports the last ninety days of mail, so open conversations carry on where they left off. Next, paste the chat widget script into your site and pick the hours when chat shows as online. Outside those hours the widget offers an email form, and the message lands in the same queue.",
        "Day two is about habits. Write your ten most common saved replies, set a first-reply target, and switch on the daily summary. Most teams stop opening the old mailbox within a week. If anything goes wrong, our support team answers in the same Brightdesk inbox we sell, usually within two business hours.",
      ],
    },
    {
      h2: "Who Brightdesk is for",
      body: [
        "Brightdesk is built for online shops, service businesses, software startups and agencies with between two and twenty people answering customers. It is not built for contact centres with hundreds of agents, telephone queues or complex workforce planning. If you need those, a larger helpdesk will suit you better, and we will tell you so on the first call.",
      ],
    },
    {
      h2: "Integrations",
      body: [
        "Brightdesk connects to Shopify, WooCommerce and Stripe, so order and payment details appear beside the conversation. It also connects to Slack for notifications, to HubSpot and Pipedrive for contact sync, and to Zapier for everything else. A documented REST API and webhooks cover the cases the built-in integrations do not.",
      ],
    },
    {
      h2: "Security and data protection",
      body: [
        "Data is stored in the European Union by default, with a United States region available on request. Every account gets single sign-on with Google and Microsoft, enforced two-factor authentication, role-based permissions and an audit log of changes to settings. We sign a data processing agreement with every customer on request and publish our list of sub-processors.",
      ],
    },
    {
      h2: "What customers say",
      body: [
        "\"We moved three people off a shared Outlook mailbox in one afternoon. The first week we found eleven conversations that had never been answered.\" - Operations lead, an online homeware shop.",
        "\"The WhatsApp channel alone paid for it. Half our customers message us there now and it sits in the same queue as email.\" - Founder, a bike repair and rental business.",
      ],
    },
    {
      h2: "Frequently asked questions",
      body: [
        "Do I need to change my support email address? No. You keep your existing address and forward it to Brightdesk, or connect the mailbox directly.",
        "Is there a free trial? Yes. Every plan has a fourteen-day trial with all features switched on, and you do not need a card to start.",
        "Can I import my history from another helpdesk? Yes. Brightdesk imports conversations, contacts and saved replies from the most common helpdesks and from any mailbox over IMAP.",
        "How is Brightdesk priced? Per teammate per month, with a discount for annual billing. See the pricing page for the current plans.",
      ],
    },
  ],
  cta: "Start your free trial",
};

function el(tag, text, attrs) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

function renderNav(root) {
  const nav = el("nav");
  for (const [href, label] of NAV) nav.appendChild(el("a", label, { href }));
  root.appendChild(nav);
}

function renderHome(root) {
  const main = el("main");
  main.appendChild(el("h1", HOME.h1));
  main.appendChild(el("p", HOME.lede));
  for (const s of HOME.sections) {
    const section = el("section");
    section.appendChild(el("h2", s.h2));
    for (const p of s.body) section.appendChild(el("p", p));
    main.appendChild(section);
  }
  main.appendChild(el("a", HOME.cta, { href: "/signup", class: "cta" }));
  root.appendChild(main);
}

function renderNotFound(root) {
  const main = el("main");
  main.appendChild(el("h1", "404"));
  main.appendChild(el("p", "Sorry, we couldn't find that page."));
  main.appendChild(el("a", "Back to home", { href: "/" }));
  root.appendChild(main);
}

const ROUTES = { "/": renderHome };

const root = document.getElementById("root");
renderNav(root);
(ROUTES[window.location.pathname] || renderNotFound)(root);
const footer = el("footer", "Brightdesk Ltd. Registered in England and Wales.");
root.appendChild(footer);
