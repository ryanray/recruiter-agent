import Anthropic from '@anthropic-ai/sdk';
import type { Applicant, ScreeningResult, ExtractedProfile, Config } from './types.js';

const client = new Anthropic();

export async function screenApplicant(applicant: Applicant, config: Config): Promise<ScreeningResult> {
  const profile = await extractProfile(applicant);
  return applyRules(profile, config);
}

async function extractProfile(applicant: Applicant): Promise<ExtractedProfile> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Extract structured information from this job applicant's profile. Return ONLY valid JSON with no markdown.

Name: ${applicant.name}
Location on profile: ${applicant.location ?? 'not provided'}
Resume text: ${applicant.resumeText ?? 'not provided'}

Return exactly this JSON structure:
{
  "location": "city, state string or null if not found",
  "distanceMiles": estimated driving miles from South Jordan Utah (84095) as a number, or null if you cannot determine location,
  "hasLicense": true if they mention valid driver's license, false if they say they don't have one, null if not mentioned,
  "hasTransportation": true if they mention reliable transportation or a car, false if they say they don't have transportation, null if not mentioned,
  "certifications": array of strings from this list only: ["CNA", "CPR", "First Aid"] — only include ones explicitly mentioned,
  "experienceTypes": array from ["home_care", "care_facility", "family", "none"] — include all that apply based on their work history,
  "yearsExperience": total years of direct care experience as a number, or null if cannot determine
}`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return JSON.parse(text) as ExtractedProfile;
}

export function applyRules(profile: ExtractedProfile, config: Config): ScreeningResult {
  const reasons: string[] = [];
  let decision: 'PASS' | 'FAIL' | 'UNSURE' = 'PASS';

  const required = config.screening.required;

  if (required.includes('within_20_miles_south_jordan')) {
    if (profile.distanceMiles === null) {
      if (decision !== 'FAIL') decision = 'UNSURE';
      reasons.push('Could not determine distance from South Jordan');
    } else if (profile.distanceMiles > 20) {
      decision = 'FAIL';
      reasons.push(`Location is ${profile.distanceMiles} miles from South Jordan (max 20)`);
    }
  }

  if (required.includes('valid_license_and_transportation')) {
    if (profile.hasLicense === null || profile.hasTransportation === null) {
      if (decision !== 'FAIL') decision = 'UNSURE';
      reasons.push('Could not confirm valid license and reliable transportation');
    } else if (!profile.hasLicense || !profile.hasTransportation) {
      decision = 'FAIL';
      reasons.push('Does not have valid license and/or reliable transportation');
    }
  }

  const hasCNA = profile.certifications.map(c => c.toUpperCase()).includes('CNA');
  const hasCareExp =
    profile.experienceTypes.includes('home_care') ||
    profile.experienceTypes.includes('care_facility');
  const isUrgent = hasCNA && hasCareExp && (profile.yearsExperience ?? 0) >= 1;

  return { decision, reasons, extractedData: profile, isUrgent };
}
