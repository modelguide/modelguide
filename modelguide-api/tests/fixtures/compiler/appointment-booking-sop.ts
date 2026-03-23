/**
 * Appointment Booking SOP fixture — validates the eval suite infrastructure
 * is SOP-agnostic by testing a completely different workflow structure.
 *
 * Scenario: voice agent handles appointment booking requests.
 * Tools: calendar_check_availability, calendar_book_appointment
 */

import type { SopDetailResponse } from "@features/compiler/core/types";

export const appointmentBookingSop: SopDetailResponse = {
  id: "sop-appointment-booking-001",
  name: "Voice — Appointment Booking",
  slug: "voice-appointment-booking",
  description:
    "Handle inbound voice requests for appointment booking. Greet the caller, check availability, book the appointment, and confirm details.",
  status: "active",
  version: "1.0",
  assignedAgents: [],
  sopTemplateId: null,
  template: null,
  definition: {
    schemaVersion: 1,
    trigger: {
      type: "intent_detected",
      config: {
        patterns: [
          "book an appointment",
          "schedule a visit",
          "make an appointment",
          "I need to see someone",
        ],
      },
    },
    steps: [
      {
        id: "greet-caller",
        order: 1,
        instruction:
          "Greet the caller warmly and ask how you can help them today.",
        required: true,
      },
      {
        id: "collect-details",
        order: 2,
        instruction:
          "Ask the caller for their preferred date, time, and appointment type (consultation, follow-up, or new patient). Confirm the details back to them.",
        required: true,
      },
      {
        id: "check-availability",
        order: 3,
        instruction:
          "Check the calendar for available slots matching the caller's preferences.",
        required: true,
        tool: {
          connectorToolId: "00000000-0000-0000-0000-000000000003",
          connectorId: "00000000-0000-0000-0000-000000000030",
          resolvedName: "scheduling_check_availability",
        },
      },
      {
        id: "book-appointment",
        order: 4,
        instruction:
          "Book the appointment in the selected time slot. Include the caller's name, appointment type, and any notes.",
        required: true,
        tool: {
          connectorToolId: "00000000-0000-0000-0000-000000000004",
          connectorId: "00000000-0000-0000-0000-000000000030",
          resolvedName: "scheduling_book_appointment",
        },
      },
      {
        id: "confirm-details",
        order: 5,
        instruction:
          "Confirm the booking details with the caller: date, time, appointment type, and any preparation instructions. Thank them and offer further assistance.",
        required: true,
      },
    ],
    metadata: {
      reasonCode: "APPT-001",
      tags: ["appointment", "booking", "voice"],
      estimatedDuration: "3-5 minutes",
    },
  },
  createdBy: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: null,
};
