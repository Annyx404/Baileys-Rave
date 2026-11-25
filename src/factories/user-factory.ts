import { any } from 'zod';

import { HttpWorkflow } from '../core/httpworkflow';
import { EditProfileBuilder, RaveConfig, Sites, User } from '../schemas';
import { contentHashOf } from '../utils/cryptography';
import {
  EditProfileResponse,
  EditProfileSchema,
  GetAvatarUploadResponse,
  GetAvatarUploadSchema,
  GetUserResponse,
  GetUserSchema,
  FriendshipResponse,
  FriendshipSchema,
  GetSuccessResponse,
  GetSuccessSchema,
  GetFriendsResponse,
  GetFriendsSchema,
} from '../schemas/responses';

export interface ProfileChanges {
  name?: string;
  handle?: string;
  avatar?: string;
  country?: string;
  globalHideMature?: boolean;
  metadata?: { position: number; privacy: string };
}

export interface GalleryItem {
  id: string;
  aspectRatio?: string;
  images?: Record<string, string>;
  mediaClass?: string;
  metadata?: { position?: number; privacy?: string };
}

export class UserFactory {
  private readonly __http: HttpWorkflow;
  private readonly __config: RaveConfig;

  constructor(http: HttpWorkflow, config: RaveConfig = {}) {
    this.__http = http;
    this.__config = config;
  }

  private __friendshipRequests = async (
    body: string,
  ): Promise<FriendshipResponse> => {
    return await this.__http.sendPost<FriendshipResponse>(
      {
        path: `/friendships`,
        body,
      },
      FriendshipSchema,
    );
  };

  private __friendshipDelete = async (
    path: string,
  ): Promise<GetSuccessResponse> => {
    return await this.__http.sendDelete<GetSuccessResponse>(
      {
        path,
      },
      GetSuccessSchema,
    );
  };

  public get = async (userId: number): Promise<GetUserResponse> => {
    return await this.__http.sendGet<GetUserResponse>(
      {
        path: `/profiles/${userId}?exclude=false&clientVersion=1`,
      },
      GetUserSchema,
    );
  };

  public getFriends = async (limit: number = 24): Promise<User[]> => {
    return (
      await this.__http.sendGet<GetFriendsResponse>(
        {
          path: `/friendships?limit=${limit}`,
        },
        GetFriendsSchema,
      )
    ).data;
  };

  public sendFriendship = async (
    userId: number,
  ): Promise<FriendshipResponse> => {
    return await this.__friendshipRequests(JSON.stringify({ id: userId }));
  };

  public acceptFriendship = async (
    userId: number,
  ): Promise<FriendshipResponse> => {
    return await this.__friendshipRequests(
      JSON.stringify({ id: userId, state: 'friends' }),
    );
  };

  public declineFriendship = async (
    userId: number,
  ): Promise<FriendshipResponse> => {
    return await this.__friendshipRequests(
      JSON.stringify({ id: userId, state: 'notfriends' }),
    );
  };

  public deleteFriendship = async (userId: number): Promise<boolean> =>
    (await this.__friendshipDelete(`/friendships?id=${userId}`)).success;

  public deleteFriend = async (userId: number): Promise<boolean> =>
    (await this.__friendshipDelete(`/friendships/unfriend?id=${userId}`))
      .success;

  public edit = async (
    builder: EditProfileBuilder,
  ): Promise<EditProfileResponse> => {
    return await this.__http.sendPut<EditProfileResponse>(
      {
        path: '/users/self',
        body: JSON.stringify(builder),
      },
      EditProfileSchema,
    );
  };

  public hideLocation = async (hide = true): Promise<boolean> => {
    const resp = await this.__http.sendPost<{ success?: boolean }>(
      {
        path: '/users/self/location',
        body: JSON.stringify({ hideLocation: hide }),
      },
      any(),
    );
    return !!resp?.success;
  };

  public updateProfile = async (
    userId: number,
    changes: ProfileChanges,
  ): Promise<unknown> => {
    const current = await this.__http.sendGet<any>(
      { path: `/profiles/${userId}?exclude=false&clientVersion=1` },
      any(),
    );
    const p = current?.data?.profile;
    if (!p) throw new Error('Perfil não encontrado na resposta do servidor');

    const profile: Record<string, unknown> = {
      avatar: p.avatar,
      country: p.country,
      globalHideMature: p.globalHideMature,
      handle: p.handle,
      metadata: p.metadata,
      name: p.name,
      state: p.state,
    };
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) profile[key] = value;
    }

    return await this.__http.sendPut<unknown>(
      {
        path: '/profiles',
        body: JSON.stringify({ profile, exclude: false, clientVersion: 1 }),
      },
      any(),
    );
  };

  public getMany = async (
    userIds: number | number[],
    includeOnline = true,
  ): Promise<User[]> => {
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(Number);
    const resp = await this.__http.sendPost<{ data?: User[] }>(
      {
        path: '/users/list',
        body: JSON.stringify({
          deviceId: this.__config?.credentials?.deviceId,
          ids,
          includeOnline,
        }),
      },
      any(),
    );
    return resp?.data ?? [];
  };

  public getAvatarUpload = async (
    mime = 'image/jpeg',
  ): Promise<GetAvatarUploadResponse> => {
    return await this.__http.sendPost<GetAvatarUploadResponse>(
      {
        path: '/users/self/avatar/upload',
        body: JSON.stringify({ mime }),
      },
      GetAvatarUploadSchema,
    );
  };

  public uploadOnUrl = async (
    uploadUrl: string,
    image: Buffer,
    mime = 'image/jpeg',
  ): Promise<any> => {
    return await this.__http.sendRaw(
      {
        path: uploadUrl,
        method: 'PUT',
        body: image,
        headers: {
          'Content-Type': mime,
        },
      },
      any(),
    );
  };

  public uploadAvatar = async (
    image: Buffer,
    mime = 'image/jpeg',
  ): Promise<string> => {
    const { data } = await this.getAvatarUpload(mime);
    await this.uploadOnUrl(data.uploadUrl, image, mime);
    return data.uploadUrl;
  };

  public setAvatar = async (
    image: Buffer,
    mime = 'image/jpeg',
    aspectRatio = '1.00',
    contentHash?: string,
  ): Promise<EditProfileResponse> => {
    const displayAvatar = await this.uploadAvatar(image, mime);

    return await this.__http.sendPut<EditProfileResponse>(
      {
        path: '/users/self',
        body: JSON.stringify({
          aspectRatio,
          contentHash: contentHash ?? contentHashOf(image),
          displayAvatar,
        }),
      },
      EditProfileSchema,
    );
  };

  public getGallery = async (userId: number): Promise<GalleryItem[]> => {
    const resp = await this.__http.sendGet<any>(
      { path: `/profiles/${userId}?exclude=false&clientVersion=1` },
      any(),
    );
    const gallery = resp?.data?.gallery ?? resp?.data?.profile?.gallery;
    return Array.isArray(gallery) ? gallery : [];
  };

  public addGalleryItem = async (
    image: Buffer,
    mime = 'image/jpeg',
    aspectRatio = '1.00',
    contentHash?: string,
  ): Promise<GalleryItem | null> => {
    const galleryItem = await this.uploadAvatar(image, mime);

    const resp = await this.__http.sendPut<{ data?: GalleryItem }>(
      {
        path: '/profiles/gallery',
        body: JSON.stringify({
          aspectRatio,
          contentHash: contentHash ?? contentHashOf(image),
          galleryItem,
        }),
      },
      any(),
    );
    return resp?.data ?? null;
  };

  public deleteGalleryItem = async (itemId: string): Promise<boolean> => {
    const resp = await this.__http.sendDelete<{ success?: boolean }>(
      { path: `/profiles/gallery/${itemId}` },
      any(),
    );
    return resp?.success !== false;
  };
}
