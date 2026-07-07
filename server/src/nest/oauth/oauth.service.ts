import { Injectable } from '@nestjs/common';
import * as oauth from '../../services/oauthService';
import { isAddonEnabled } from '../../services/adminService';
import { ADDON_IDS } from '../../addons';
import { getMcpSafeUrl } from '../../services/notifications';

/**
 * Thin Nest wrapper around the existing OAuth 2.1 service. The grant handling,
 * PKCE, client auth, consent storage, token issue/refresh/revoke and the
 * client/session CRUD all reuse the legacy code unchanged.
 */
@Injectable()
export class OauthService {
  mcpEnabled(): boolean { return isAddonEnabled(ADDON_IDS.MCP); }
  mcpSafeUrl(): string { return getMcpSafeUrl(); }

  consumeAuthCode(code: string) { return oauth.consumeAuthCode(code); }
  authenticateClient(clientId: string, clientSecret?: string) { return oauth.authenticateClient(clientId, clientSecret); }
  verifyPKCE(verifier: string, challenge: string) { return oauth.verifyPKCE(verifier, challenge); }
  issueTokens(...args: Parameters<typeof oauth.issueTokens>) { return oauth.issueTokens(...args); }
  issueClientCredentialsToken(...args: Parameters<typeof oauth.issueClientCredentialsToken>) { return oauth.issueClientCredentialsToken(...args); }
  refreshTokens(...args: Parameters<typeof oauth.refreshTokens>) { return oauth.refreshTokens(...args); }
  revokeToken(...args: Parameters<typeof oauth.revokeToken>) { return oauth.revokeToken(...args); }
  getUserByAccessToken(token: string) { return oauth.getUserByAccessToken(token); }

  validateAuthorizeRequest(params: oauth.AuthorizeParams, userId: number | null) { return oauth.validateAuthorizeRequest(params, userId); }
  saveConsent(...args: Parameters<typeof oauth.saveConsent>) { return oauth.saveConsent(...args); }
  createAuthCode(...args: Parameters<typeof oauth.createAuthCode>) { return oauth.createAuthCode(...args); }

  listOAuthClients(userId: number) { return oauth.listOAuthClients(userId); }
  createOAuthClient(...args: Parameters<typeof oauth.createOAuthClient>) { return oauth.createOAuthClient(...args); }
  rotateOAuthClientSecret(...args: Parameters<typeof oauth.rotateOAuthClientSecret>) { return oauth.rotateOAuthClientSecret(...args); }
  deleteOAuthClient(...args: Parameters<typeof oauth.deleteOAuthClient>) { return oauth.deleteOAuthClient(...args); }
  listOAuthSessions(userId: number) { return oauth.listOAuthSessions(userId); }
  revokeSession(...args: Parameters<typeof oauth.revokeSession>) { return oauth.revokeSession(...args); }
}
