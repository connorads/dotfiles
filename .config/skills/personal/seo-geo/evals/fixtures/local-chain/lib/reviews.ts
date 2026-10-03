import cities from "@/data/cities.json";
import { sendSms } from "./sms";

// Called by the SmileBook "appointment completed" webhook.
export type AppointmentCompleted = {
  patientPhone: string;
  patientFirstName: string;
  clinicSlug: string;
  dentistName: string;
};

const GOOGLE_REVIEW_LINKS: Record<string, string> = Object.fromEntries(
  cities
    .filter((c) => c.hasPremises)
    .map((c) => [c.slug, `https://g.page/r/northgate-${c.slug}/review`]),
);

const FEEDBACK_FORM = "https://northgatedental.co.uk/feedback";

// TODO(agency): wire this to the webhook route.
export async function onAppointmentCompleted(a: AppointmentCompleted): Promise<void> {
  await sendSms(
    a.patientPhone,
    `Hi ${a.patientFirstName}, thanks for visiting Northgate Dental today! On a scale of 0-10, how likely are you to recommend us? Reply with a number.`,
  );
}

// Called when the patient replies to the NPS text.
export async function onNpsReply(a: AppointmentCompleted, score: number): Promise<void> {
  if (score >= 9) {
    await sendSms(
      a.patientPhone,
      `So glad you had a great visit! Would you share it on Google? Please mention ${a.dentistName} by name - it really helps the team. ${GOOGLE_REVIEW_LINKS[a.clinicSlug]}`,
    );
    return;
  }
  await sendSms(a.patientPhone, `Sorry we didn't get it quite right. Tell us privately what we can do better: ${FEEDBACK_FORM}`);
}
