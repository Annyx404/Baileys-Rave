import { any } from 'zod';
import { request } from 'undici';

import {
  VIDEO_URL_BASE,
  YOUTUBE_SEARCH_PARAMS,
  YOUTUBE_SEARCH_URL,
  YOUTUBE_WEB_CLIENT_VERSION,
} from '../constants';
import { HttpWorkflow } from '../core/httpworkflow';
import { buildRaveDisneyBody, DisneyPlayable } from '../utils/disney';
import { parseYoutubeSearch, YoutubeSearchResult } from '../utils/youtube';

export type { YoutubeSearchResult } from '../utils/youtube';

export interface YoutubeVideoInput {
  providerId: string;
  title: string;
  duration: number | string;
  thumbnail: string;
  author?: string;
  description?: string;
  isLive?: boolean;
  maturity?: string;
  viewCount?: number;
  thumbnails?: Record<string, string>;
  url?: string;
}

export interface RaveVideo {
  id: string;
  providerId: string;
  title: string;
  [key: string]: unknown;
}

export const toIsoDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `PT${Math.floor(s / 3600)}H${Math.floor((s % 3600) / 60)}M${s % 60}S`;
};

export const raveVideoUrl = (
  video: string,
  base: string = VIDEO_URL_BASE,
): string =>
  /^https?:\/\//i.test(video)
    ? video
    : `${base.replace(/\/+$/, '')}/videos/youtube/${video}`;

export const raveDisneyUrl = (
  video: string,
  base: string = VIDEO_URL_BASE,
): string =>
  /^https?:\/\//i.test(video)
    ? video
    : `${base.replace(/\/+$/, '')}/videos/disney/${video}`;

export class VideoFactory {
  private readonly __http: HttpWorkflow;

  constructor(http: HttpWorkflow) {
    this.__http = http;
  }

  public registerYoutube = async (
    video: YoutubeVideoInput,
  ): Promise<RaveVideo> => {
    const body: Record<string, unknown> = {
      description: video.description ?? '',
      duration:
        typeof video.duration === 'number'
          ? toIsoDuration(video.duration)
          : video.duration,
      isLive: !!video.isLive,
      providerId: video.providerId,
      thumbnail: video.thumbnail,
      thumbnails: video.thumbnails ?? { low: video.thumbnail },
      title: video.title,
      url: video.url ?? `http://www.youtube.com/watch?v=${video.providerId}`,
      viewCount: video.viewCount ?? 0,
    };
    if (video.author !== undefined) body.author = video.author;
    if (video.maturity !== undefined) body.maturity = video.maturity;

    const resp = await this.__http.sendPost<{ data: RaveVideo }>(
      { path: '/videos/youtube', body: JSON.stringify(body) },
      any(),
    );
    return resp.data;
  };

  public getYoutube = async (raveVideoId: string): Promise<RaveVideo> => {
    const resp = await this.__http.sendGet<{ data: RaveVideo }>(
      { path: `/videos/youtube/${raveVideoId}` },
      any(),
    );
    return resp.data;
  };

  public registerDisney = async (
    playable: DisneyPlayable,
  ): Promise<RaveVideo> => {
    const resp = await this.__http.sendPost<{ data: RaveVideo }>(
      {
        path: '/videos/disney',
        body: JSON.stringify(buildRaveDisneyBody(playable)),
      },
      any(),
    );
    return resp.data;
  };

  public getDisney = async (raveVideoId: string): Promise<RaveVideo> => {
    const resp = await this.__http.sendGet<{ data: RaveVideo }>(
      { path: `/videos/disney/${raveVideoId}` },
      any(),
    );
    return resp.data;
  };

  public disneyUrl = (raveVideoId: string, base?: string): string =>
    raveDisneyUrl(raveVideoId, base);

  public searchYoutube = async (
    query: string,
    limit = 5,
  ): Promise<YoutubeSearchResult[]> => {
    const { statusCode, body } = await request(YOUTUBE_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        query,
        params: YOUTUBE_SEARCH_PARAMS,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: YOUTUBE_WEB_CLIENT_VERSION,
          },
        },
      }),
    });

    if (statusCode < 200 || statusCode >= 300) {
      await body.text().catch(() => '');
      throw new Error(`Falha na busca do YouTube (HTTP ${statusCode})`);
    }

    const json: any = await body.json();
    const results = parseYoutubeSearch(json).slice(0, Math.max(1, limit));

    if (
      results.length === 0 &&
      !json?.contents?.twoColumnSearchResultsRenderer
    ) {
      throw new Error(
        'Busca do YouTube: formato de resposta não reconhecido (o layout pode ter mudado)',
      );
    }

    return results;
  };
}
