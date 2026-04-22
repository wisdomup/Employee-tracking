import api from './api';

export interface ProfileAddress {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
}

/** Response shape from GET /users/me (Mongoose lean/toObject). */
export interface ProfileDocument {
  _id: string;
  userID: string;
  username: string;
  fullName?: string;
  phone: string;
  email?: string;
  role: string;
  address?: ProfileAddress;
  profileImage?: string;
}

export interface ProfileUpdateBody {
  username?: string;
  phone?: string;
  fullName?: string;
  email?: string;
  address?: ProfileAddress;
  profileImage?: string;
}

export const profileService = {
  async getProfileDocument(): Promise<ProfileDocument> {
    const { data } = await api.get<ProfileDocument>('/users/me');
    return data;
  },

  async updateProfile(body: ProfileUpdateBody): Promise<ProfileDocument> {
    const { data } = await api.patch<ProfileDocument>('/users/me', body);
    return data;
  },
};
