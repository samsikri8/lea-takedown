/**
 * Registry of real reporting channels per platform. No major platform exposes a
 * third-party "delete this post" API, so the real takedown channel is (a) the
 * platform's designated legal/abuse contact for a formal notice, and/or (b) the
 * platform's official report form. We email the notice where a contact exists
 * and always surface the form URL for the survivor's records.
 *
 * Addresses are best-known public designated-agent / legal contacts and reporting
 * portals. Verify against each platform's current Terms/DMCA agent before relying
 * on them in production.
 */
export interface PlatformChannel {
  legalEmail?: string;
  reportUrl: string;
  ncii?: string;
}

const REGISTRY: Record<string, PlatformChannel> = {
  Instagram: {
    legalEmail: "ip@fb.com",
    reportUrl: "https://help.instagram.com/contact/504521742987441",
    ncii: "https://stopncii.org",
  },
  Facebook: {
    legalEmail: "ip@fb.com",
    reportUrl: "https://www.facebook.com/help/contact/634636770043106",
    ncii: "https://stopncii.org",
  },
  X: {
    legalEmail: "copyright@x.com",
    reportUrl: "https://help.x.com/en/forms/safety-and-sensitive-content",
  },
  TikTok: {
    legalEmail: "legal@tiktok.com",
    reportUrl: "https://www.tiktok.com/legal/report/feedback",
    ncii: "https://stopncii.org",
  },
  Reddit: {
    legalEmail: "legal-notices@reddit.com",
    reportUrl: "https://www.reddit.com/report",
  },
  YouTube: {
    reportUrl: "https://support.google.com/youtube/answer/2802027",
  },
};

const DEFAULT: PlatformChannel = {
  reportUrl: "https://www.ftc.gov/complaint",
};

export function channelFor(platform: string): PlatformChannel {
  return REGISTRY[platform] ?? DEFAULT;
}
