/**
 * Browser-safe contract for the purchase step.  Confidential questionnaire
 * labels, examples, groups and full-field requirements live only in
 * server/salesScriptQuestionnairePrivate.ts and are returned after payment.
 */
export const BASIC_SALES_SCRIPT_QUESTION_IDS = [
  "planName", "audience", "painPoints", "modules", "pricing",
] as const;

export type BasicSalesScriptQuestionId = typeof BASIC_SALES_SCRIPT_QUESTION_IDS[number];
export type SalesScriptQuestionId = BasicSalesScriptQuestionId
  | "instructor" | "bonuses" | "subtitle" | "outcome" | "timeframe"
  | "oldMethod" | "solution" | "instructorInitialProblem" | "instructorTurningPoint"
  | "instructorAuthority" | "instructorAchievements" | "methodDiscovery" | "methodValue"
  | "benefitsScenarios" | "productName" | "productImageDescription" | "tagline"
  | "modulesUniqueHelp" | "educationWhyBuy" | "commonObjections" | "bonusesCourse"
  | "bonusesCoaching" | "bonusesTemplates" | "bonusesPartnerResources" | "originalPrice"
  | "offerPrice" | "discountReason" | "installments" | "genuineLimits" | "deadline"
  | "testimonials" | "guaranteeTerms" | "faqTime" | "faqAbility" | "faqEffect"
  | "faqMoney" | "signupSteps";

export type SalesScriptQuestionnaireAnswers = Partial<Record<SalesScriptQuestionId, string>>;
export type SalesScriptQuestionnaireField = {
  id: SalesScriptQuestionId; label: string; required: boolean; help: string;
  example: string; placeholder: string; multiline?: boolean;
};
export type SalesScriptQuestionGroup = {
  id: string; title: string; description: string; fields: readonly SalesScriptQuestionnaireField[];
};

export function pickBasicSalesScriptAnswers(answers: Record<string, string>): Record<BasicSalesScriptQuestionId, string> {
  return Object.fromEntries(BASIC_SALES_SCRIPT_QUESTION_IDS.map((id) => [id, answers[id] ?? ""])) as
    Record<BasicSalesScriptQuestionId, string>;
}

export function hasOnlyBasicSalesScriptAnswers(answers: Record<string, string>): boolean {
  return Object.keys(answers).every((id) => (BASIC_SALES_SCRIPT_QUESTION_IDS as readonly string[]).includes(id));
}