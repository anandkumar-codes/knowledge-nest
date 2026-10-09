import { createClient } from './client.js';

export const MEMBER_UNAUTHORIZED_EVENT = 'kn:member-unauthorized';

const client = createClient({
  storageKey: 'kn_member_session',
  unauthorizedEvent: MEMBER_UNAUTHORIZED_EVENT,
  loginPath: '/portal/login',
});

export async function memberLogin({ phone, password, remember }) {
  const { token, member } = await client.api('/portal/login', { method: 'POST', body: { phone: phone.trim(), password, remember } });
  client.setToken(token, remember);
  return member;
}

export const memberLogout = () => client.clearToken();
export const hasMemberSession = () => !!client.getToken();

export const getPortal = () => client.api('/portal/me');
export const updateProfile = (body) => client.api('/portal/me', { method: 'PATCH', body }).then((d) => d.member);
// Other devices are signed out; this one keeps going with the fresh token the server returns.
export async function changeMemberPassword(currentPassword, newPassword) {
  const { token, member } = await client.api('/portal/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  client.replaceToken(token);
  return member;
}
// Resolves to { claim, payment? }: `payment` is present when the payment was confirmed automatically.
export const submitUpiPayment = (body) => client.api('/portal/claims', { method: 'POST', body });
