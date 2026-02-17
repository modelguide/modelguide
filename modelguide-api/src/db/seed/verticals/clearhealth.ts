/**
 * ClearHealth — Medical call center vertical.
 * Use case: Patient support, prescription refills, appointment scheduling.
 * Channel mix: voice-dominant (40% voice) — typical for healthcare call centers.
 */

import type { OrgVerticalConfig } from "./types";

const config: OrgVerticalConfig = {
  org: {
    name: "ClearHealth",
    slug: "clearhealth",
    timezone: "America/Chicago",
    features: ["voice-agents"],
  },

  users: {
    admin: {
      email: "delivered+admin-clearhealth@resend.dev",
      name: "Dr. James Rivera",
    },
    support: {
      email: "delivered+support-clearhealth@resend.dev",
      name: "Nurse Amy Chen",
    },
    viewer: {
      email: "demo-viewer-clearhealth@modelguide.dev",
      name: "Demo Viewer",
    },
    inactive: {
      email: "delivered+inactive-clearhealth@resend.dev",
      name: "Former Staffer",
    },
  },

  ecommerce: {
    connectorName: "ClearHealth Pharmacy",
    connectorSlug: "clearhealth_pharmacy",
    config: {
      baseUrl: "https://pharmacy.clearhealth.example.com",
      publishableKey: "pk_clearhealth_placeholder",
    },
  },

  helpdesk: {
    connectorName: "ClearHealth Patient Support",
    connectorSlug: "clearhealth_support",
    config: {
      subdomain: "clearhealth",
      email: "patientsupport@clearhealth.example.com",
    },
  },

  agents: [
    {
      name: "ClearHealth Phone Assistant",
      slug: "clearhealth-phone-assistant",
      description:
        "Handles patient calls for prescription refills, appointment scheduling, and insurance questions",
    },
    {
      name: "ClearHealth Patient Portal Bot",
      slug: "clearhealth-patient-portal",
      description:
        "Web portal chatbot for billing inquiries, lab results, referral requests, and general patient support",
    },
  ],

  products: [
    {
      name: "Metformin 500mg",
      price: 12,
      variants: ["30-count", "90-count"],
      category: "prescriptions",
    },
    {
      name: "Lisinopril 10mg",
      price: 8,
      variants: ["30-count", "90-count"],
      category: "prescriptions",
    },
    {
      name: "Pulse Oximeter",
      price: 35,
      variants: ["Standard", "Bluetooth"],
      category: "devices",
    },
    {
      name: "Blood Pressure Monitor",
      price: 65,
      variants: ["Arm Cuff", "Wrist Cuff"],
      category: "devices",
    },
    {
      name: "Vitamin D3 2000IU",
      price: 15,
      variants: ["60-count", "120-count"],
      category: "supplements",
    },
    {
      name: "First Aid Kit",
      price: 29,
      variants: ["Basic", "Comprehensive"],
      category: "supplies",
    },
    {
      name: "Amoxicillin 500mg",
      price: 14,
      variants: ["14-count", "21-count"],
      category: "prescriptions",
    },
    {
      name: "Omeprazole 20mg",
      price: 18,
      variants: ["14-count", "42-count"],
      category: "prescriptions",
    },
  ],

  ticketTemplates: [
    {
      subject: "Prescription refill not ready after 48 hours",
      priority: "urgent",
      type: "problem",
      tags: ["pharmacy", "refill", "delay"],
    },
    {
      subject: "Billing discrepancy on last statement",
      priority: "high",
      type: "problem",
      tags: ["billing", "dispute"],
    },
    {
      subject: "Request to reschedule appointment",
      priority: "normal",
      type: "task",
      tags: ["scheduling", "appointment"],
    },
    {
      subject: "Insurance coverage question for procedure",
      priority: "normal",
      type: "question",
      tags: ["insurance", "coverage"],
    },
    {
      subject: "Lab results not showing in patient portal",
      priority: "high",
      type: "incident",
      tags: ["lab", "portal", "results"],
    },
    {
      subject: "Referral to cardiologist needed",
      priority: "normal",
      type: "task",
      tags: ["referral", "specialist"],
    },
  ],

  generalQA: [
    {
      q: "What are your pharmacy hours?",
      a: "Our pharmacy is open Monday-Friday 8 AM to 8 PM, Saturday 9 AM to 5 PM, and Sunday 10 AM to 2 PM (Central Time). Drive-through pickup is available during all hours.",
    },
    {
      q: "How do I transfer a prescription from another pharmacy?",
      a: "We can handle the transfer for you! Just provide the name and phone number of your current pharmacy, and the medication name. We'll contact them directly. Most transfers are completed within 24 hours.",
    },
    {
      q: "Do you accept my insurance?",
      a: "We accept most major insurance plans including Blue Cross, Aetna, UnitedHealthcare, Cigna, and Medicare Part D. You can verify your specific coverage by providing your insurance ID when you call or visit.",
    },
    {
      q: "How do I access my lab results?",
      a: "Lab results are available through our patient portal at portal.clearhealth.example.com. Results typically appear within 3-5 business days. If you need them sooner, your provider can share them during a follow-up.",
    },
    {
      q: "What's the cost of a telehealth visit?",
      a: "Telehealth visits are $45 without insurance, or your standard copay with insurance. Most plans now cover telehealth at the same rate as in-person visits.",
    },
    {
      q: "Can I get a prescription delivered?",
      a: "Yes! We offer same-day delivery within 15 miles for $5.99, or free next-day delivery on all prescriptions. Just let us know when you place your refill.",
    },
  ],

  orderPrefix: "RX-",
  ticketIdRange: [20000, 29999],
  baseUrl: "https://pharmacy.clearhealth.example.com",
  helpdeskBaseUrl: "https://clearhealth.zendesk.com",

  scenarioWeights: [
    { value: "product_inquiry", weight: 10 },
    { value: "purchase_flow", weight: 15 },
    { value: "order_status", weight: 10 },
    { value: "return_exchange", weight: 5 },
    { value: "ticket_lookup", weight: 20 },
    { value: "ticket_creation", weight: 20 },
    { value: "ticket_escalation", weight: 10 },
    { value: "general_question", weight: 10 },
  ],

  channelWeights: [
    { value: "voice", weight: 40 },
    { value: "web", weight: 15 },
    { value: "sms", weight: 15 },
    { value: "whatsapp", weight: 10 },
    { value: "email", weight: 10 },
    { value: "widget", weight: 5 },
    { value: "slack", weight: 3 },
    { value: "api", weight: 2 },
  ],

  feedback: {
    positiveCustomer: [
      "Got my prescription sorted quickly",
      "Very helpful with insurance questions",
      "Appointment rescheduled easily",
      "The agent was knowledgeable and patient",
      "Refill was ready when promised",
      "Clear explanation of my options",
      "Appreciated the follow-up",
      "Made a stressful situation much easier",
    ],
    negativeCustomer: [
      "Had to wait on hold too long",
      "Prescription still not ready",
      "Billing issue not fully resolved",
      "Portal is confusing to navigate",
      "Expected a callback that never came",
      "Insurance answer was unclear",
    ],
    positiveSupport: [
      "Followed HIPAA protocol throughout",
      "Appropriate urgency for prescription delay",
      "Good empathy for patient frustration",
      "Correctly routed specialist referral",
      "Verified patient identity properly",
    ],
    negativeSupport: [
      "Should have confirmed medication allergies",
      "Missed opportunity to offer generic alternative",
      "Insurance explanation lacked detail",
      "Should have escalated billing dispute sooner",
    ],
  },

  handwrittenSessions: [
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      userIdentifier: "+1-555-0301",
      hoursAgo: 1,
      messages: [
        {
          role: "user",
          content: "Hi, I need to refill my Metformin prescription.",
        },
        {
          role: "assistant",
          content:
            "I'd be happy to help with your refill. Can I get your date of birth and the last name on the account for verification?",
        },
        {
          role: "user",
          content: "March 15, 1978. Last name is Rodriguez.",
        },
        {
          role: "assistant",
          content:
            "Thank you, Maria. I've verified your account. I can see your Metformin 500mg prescription — you have 2 refills remaining. Shall I process the 90-count refill? It'll be $12 with your insurance.",
        },
        {
          role: "user",
          content: "Yes, the 90-count please. Can I pick it up today?",
        },
        {
          role: "assistant",
          content:
            "Your refill is now processing. It'll be ready for pickup in about 2 hours at our Main Street location. We'll send you a text when it's ready. Is there anything else?",
        },
        {
          role: "user",
          content: "No, that's all. Thank you!",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Got my prescription sorted quickly",
        source: "customer",
      },
      links: [
        {
          url: "https://pharmacy.clearhealth.example.com/orders/RX-50142",
          title: "Prescription RX-50142",
          connectorSlug: "clearhealth_pharmacy",
          resourceType: "order",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      userIdentifier: "+1-555-0302",
      hoursAgo: 4,
      messages: [
        {
          role: "user",
          content:
            "I have a question about my bill. There's a charge I don't recognize.",
        },
        {
          role: "assistant",
          content:
            "I can look into that for you. Could you verify your account with your date of birth and last name?",
        },
        {
          role: "user",
          content: "July 22, 1985. Thompson.",
        },
        {
          role: "assistant",
          content:
            "Thank you, David. I can see your account. Which charge are you referring to?",
        },
        {
          role: "user",
          content:
            "There's a $145 charge from February 3rd. I only had a regular checkup that day.",
        },
        {
          role: "assistant",
          content:
            "I see the charge — it appears to be for lab work ordered during your checkup. Your insurance covered the office visit but the lab panel was billed separately. Let me create a ticket with our billing team to review the EOB and make sure the insurance was applied correctly. They'll call you back within 24 hours.",
        },
        {
          role: "user",
          content: "Okay, I'd appreciate that.",
        },
        {
          role: "assistant",
          content:
            "I've created ticket #20342 for you. Our billing specialist will review the claim and reach out. Is there anything else I can help with?",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Helpful with my billing concern, waiting for callback",
        source: "customer",
      },
      links: [
        {
          url: "https://clearhealth.zendesk.com/tickets/20342",
          title: "Ticket #20342 — Billing inquiry",
          connectorSlug: "clearhealth_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      userIdentifier: "linda.k@example.com",
      hoursAgo: 8,
      messages: [
        {
          role: "user",
          content:
            "My lab results from last week aren't showing up in the portal.",
        },
        {
          role: "assistant",
          content:
            "I understand the frustration. Lab results typically take 3-5 business days to appear in the portal. When was your lab work done?",
        },
        {
          role: "user",
          content: "It was 6 days ago, on Monday.",
        },
        {
          role: "assistant",
          content:
            "Since it's been more than 5 business days, let me escalate this. I'm creating a priority ticket for our lab team to look into it. They'll have your results posted within 24 hours and you'll get an email notification. In the meantime, you can also call your provider's office to get the results over the phone if it's urgent.",
        },
        {
          role: "user",
          content:
            "Okay, that works. It's not urgent but I'd like to see them.",
        },
      ],
      feedback: {
        rating: 1,
        comment: "Results should be available faster",
        source: "customer",
      },
      links: [
        {
          url: "https://clearhealth.zendesk.com/tickets/20298",
          title: "Ticket #20298 — Missing lab results",
          connectorSlug: "clearhealth_support",
          resourceType: "ticket",
        },
      ],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "completed",
      userIdentifier: "+1-555-0304",
      hoursAgo: 24,
      messages: [
        {
          role: "user",
          content: "I need to schedule an appointment with Dr. Rivera.",
        },
        {
          role: "assistant",
          content:
            "I'd be happy to help schedule that. Is this for a routine visit or a specific concern?",
        },
        {
          role: "user",
          content: "Routine annual checkup.",
        },
        {
          role: "assistant",
          content:
            "Dr. Rivera has availability next Tuesday at 10 AM or Thursday at 2:30 PM. Which works better for you?",
        },
        {
          role: "user",
          content: "Thursday at 2:30 works.",
        },
        {
          role: "assistant",
          content:
            "You're all set for Thursday, February 20th at 2:30 PM with Dr. Rivera. Please arrive 15 minutes early and bring your insurance card. We'll send you a confirmation text and a reminder the day before.",
        },
        {
          role: "user",
          content: "Perfect, thank you.",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Easy scheduling process",
        source: "customer",
      },
      links: [],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "active",
      userIdentifier: "robert.m@example.com",
      hoursAgo: 0,
      messages: [
        {
          role: "user",
          content:
            "I need a referral to a cardiologist. My primary care doctor mentioned I should see one.",
        },
        {
          role: "assistant",
          content:
            "I can help get that referral started. Can you tell me your primary care provider's name so I can pull up your chart?",
        },
        {
          role: "user",
          content: "Dr. Amy Chen.",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agentIndex: 0,
      channel: "voice",
      status: "abandoned",
      userIdentifier: "+1-555-0306",
      hoursAgo: 36,
      messages: [
        {
          role: "user",
          content: "Hello?",
        },
        {
          role: "assistant",
          content: "Hello! Welcome to ClearHealth. How can I assist you today?",
        },
      ],
      feedback: null,
      links: [],
    },
    {
      agentIndex: 1,
      channel: "web",
      status: "completed",
      userIdentifier: "susan.b@example.com",
      hoursAgo: 72,
      messages: [
        {
          role: "user",
          content:
            "Does my insurance cover the new blood pressure monitor? I have Blue Cross PPO.",
        },
        {
          role: "assistant",
          content:
            "Great question! Most Blue Cross PPO plans cover home blood pressure monitors as durable medical equipment (DME) when prescribed by your doctor. The coverage is typically 80% after deductible. Our Blood Pressure Monitor (Arm Cuff model) is $65 — with your plan, your out-of-pocket would likely be around $13. Would you like me to check your specific coverage?",
        },
        {
          role: "user",
          content: "Yes, can you verify it for my plan?",
        },
        {
          role: "assistant",
          content:
            "I've submitted a coverage verification request. Our insurance team will confirm within 1 business day and notify you via email. If it's covered, we can ship it directly to your home. Anything else?",
        },
        {
          role: "user",
          content: "No, that's all for now. Thanks!",
        },
      ],
      feedback: {
        rating: 2,
        comment: "Very helpful with insurance questions",
        source: "customer",
      },
      links: [
        {
          url: "https://pharmacy.clearhealth.example.com/products/blood-pressure-monitor",
          title: "Blood Pressure Monitor",
          connectorSlug: "clearhealth_pharmacy",
          resourceType: "product",
        },
      ],
    },
  ],

  firstNames: [
    "Maria",
    "David",
    "Linda",
    "Robert",
    "Susan",
    "James",
    "Patricia",
    "Michael",
    "Jennifer",
    "William",
    "Elizabeth",
    "Richard",
    "Barbara",
    "Thomas",
    "Dorothy",
    "Karen",
    "Daniel",
    "Nancy",
    "Paul",
    "Helen",
  ],
  lastNames: [
    "Rodriguez",
    "Thompson",
    "Williams",
    "Johnson",
    "Brown",
    "Davis",
    "Miller",
    "Wilson",
    "Anderson",
    "Taylor",
    "Garcia",
    "Martinez",
    "Robinson",
    "Clark",
    "Lewis",
    "Lee",
    "Walker",
    "Hall",
    "Young",
    "King",
  ],
};

export default config;
