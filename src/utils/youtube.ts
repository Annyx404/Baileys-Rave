export interface YoutubeSearchResult {
  providerId: string;
  title: string;
  durationSeconds: number;
  durationText: string;
  author: string;
  viewCount: number | null;
  thumbnail: string;
  isLive: boolean;
  url: string;
}

export const parseClockDuration = (text?: string): number => {
  if (!text) return 0;
  const parts = text.split(':').map((p) => Number(p.trim()));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
};

const joinRuns = (node: any): string => {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? '').join('');
  return '';
};

export const parseViewCount = (renderer: any): number | null => {
  const full = joinRuns(renderer?.viewCountText).trim();
  const digits = full.replace(/[^\d]/g, '');
  if (digits) return Number(digits);

  const short = joinRuns(renderer?.shortViewCountText).trim();
  const match = short.match(/(\d+(?:[.,]\d+)?)\s*([KMB])\b/i);
  if (match) {
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[match[2].toUpperCase() as 'K' | 'M' | 'B'];
    return Math.round(Number(match[1].replace(',', '.')) * mult);
  }
  const shortDigits = short.replace(/[^\d]/g, '');
  if (shortDigits) return Number(shortDigits);

  return full || short ? 0 : null;
};

const isLiveRenderer = (renderer: any): boolean => {
  if (!renderer?.lengthText) return true;
  const badges = JSON.stringify(renderer.badges ?? []);
  return /LIVE_NOW/i.test(badges);
};

export const parseYoutubeSearch = (json: any): YoutubeSearchResult[] => {
  const sections =
    json?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ?? [];
  const results: YoutubeSearchResult[] = [];

  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const v = item?.videoRenderer;
      if (!v?.videoId) continue;

      const live = isLiveRenderer(v);
      const durationText = joinRuns(v.lengthText);

      results.push({
        providerId: String(v.videoId),
        title: joinRuns(v.title).trim() || String(v.videoId),
        durationSeconds: live ? 0 : parseClockDuration(durationText),
        durationText,
        author: joinRuns(v.ownerText ?? v.longBylineText).trim(),
        viewCount: live ? null : parseViewCount(v),
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        isLive: live,
        url: `http://www.youtube.com/watch?v=${v.videoId}`,
      });
    }
  }

  return results;
};
