import {
  CognitoIdentityProviderClient,
  CreateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  DuplicateProviderException,
  ListIdentityProvidersCommand,
  UpdateUserPoolClientCommand,
  type UpdateUserPoolClientCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import type { SsoProviderInfo, SsoProviderInput } from '@s3ndless/shared';
import { conflict, notFound } from '@s3ndless/api/http';
import type { SystemConfig } from '@s3ndless/api/model';
import type { Deps, IdentityProviders } from '@s3ndless/api/ports';
import { verifyLicense } from './license.js';

/**
 * Identity providers are managed at runtime through the Cognito API (decision: admin UI, not
 * template parameters). CloudFormation owns the app client, so a stack update can reset its
 * provider list; `reconcileSsoProviders` runs after every deploy to put it back.
 */
export class CognitoIdentityProviders implements IdentityProviders {
  constructor(
    private readonly cognito: CognitoIdentityProviderClient,
    private readonly system: () => Promise<SystemConfig>,
  ) {}

  async list(): Promise<SsoProviderInfo[]> {
    const { userPoolId } = await this.system();
    const names: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.cognito.send(new ListIdentityProvidersCommand({ UserPoolId: userPoolId, MaxResults: 60, NextToken: token }));
      for (const p of page.Providers ?? []) {
        if (p.ProviderName && (p.ProviderType === 'SAML' || p.ProviderType === 'OIDC')) names.push(p.ProviderName);
      }
      token = page.NextToken;
    } while (token);

    return Promise.all(
      names.map(async (name) => {
        const { IdentityProvider: idp } = await this.cognito.send(
          new DescribeIdentityProviderCommand({ UserPoolId: userPoolId, ProviderName: name }),
        );
        return {
          name,
          type: idp?.ProviderType === 'SAML' ? ('saml' as const) : ('oidc' as const),
          emailDomains: idp?.IdpIdentifiers ?? [],
        };
      }),
    );
  }

  async create(input: SsoProviderInput): Promise<void> {
    const { userPoolId } = await this.system();
    try {
      await this.cognito.send(
        new CreateIdentityProviderCommand(
          input.type === 'saml'
            ? {
                UserPoolId: userPoolId,
                ProviderName: input.name,
                ProviderType: 'SAML',
                ProviderDetails: { MetadataURL: input.metadataUrl, IDPSignout: 'false' },
                AttributeMapping: { email: input.emailAttribute },
                IdpIdentifiers: input.emailDomains,
              }
            : {
                UserPoolId: userPoolId,
                ProviderName: input.name,
                ProviderType: 'OIDC',
                ProviderDetails: {
                  client_id: input.clientId,
                  client_secret: input.clientSecret,
                  authorize_scopes: input.scopes,
                  oidc_issuer: input.issuer,
                  attributes_request_method: 'GET',
                },
                AttributeMapping: { email: 'email', email_verified: 'email_verified' },
                IdpIdentifiers: input.emailDomains,
              },
        ),
      );
    } catch (error) {
      if (error instanceof DuplicateProviderException) throw conflict('A provider with this name already exists', 'provider_exists');
      throw error;
    }
  }

  async delete(name: string): Promise<void> {
    const { userPoolId } = await this.system();
    await this.cognito.send(new DeleteIdentityProviderCommand({ UserPoolId: userPoolId, ProviderName: name }));
  }

  async syncClient(providerNames: string[]): Promise<void> {
    const { userPoolId, clientId } = await this.system();
    const { UserPoolClient: c } = await this.cognito.send(
      new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }),
    );
    if (!c) throw new Error('User pool client not found');
    const wanted = ['COGNITO', ...providerNames];
    const current = c.SupportedIdentityProviders ?? [];
    if (current.length === wanted.length && wanted.every((p) => current.includes(p))) return;

    // UpdateUserPoolClient resets every field that is not passed, so copy the full configuration.
    const input: UpdateUserPoolClientCommandInput = {
      UserPoolId: userPoolId,
      ClientId: clientId,
      ClientName: c.ClientName,
      RefreshTokenValidity: c.RefreshTokenValidity,
      AccessTokenValidity: c.AccessTokenValidity,
      IdTokenValidity: c.IdTokenValidity,
      TokenValidityUnits: c.TokenValidityUnits,
      ReadAttributes: c.ReadAttributes,
      WriteAttributes: c.WriteAttributes,
      ExplicitAuthFlows: c.ExplicitAuthFlows,
      SupportedIdentityProviders: wanted,
      CallbackURLs: c.CallbackURLs,
      LogoutURLs: c.LogoutURLs,
      DefaultRedirectURI: c.DefaultRedirectURI,
      AllowedOAuthFlows: c.AllowedOAuthFlows,
      AllowedOAuthScopes: c.AllowedOAuthScopes,
      AllowedOAuthFlowsUserPoolClient: c.AllowedOAuthFlowsUserPoolClient,
      AnalyticsConfiguration: c.AnalyticsConfiguration,
      PreventUserExistenceErrors: c.PreventUserExistenceErrors,
      EnableTokenRevocation: c.EnableTokenRevocation,
      EnablePropagateAdditionalUserContextData: c.EnablePropagateAdditionalUserContextData,
      AuthSessionValidity: c.AuthSessionValidity,
      RefreshTokenRotation: c.RefreshTokenRotation,
    };
    await this.cognito.send(new UpdateUserPoolClientCommand(input));
  }
}

/** Dev/test implementation. */
export class MemoryIdentityProviders implements IdentityProviders {
  private providers = new Map<string, SsoProviderInfo>();
  clientProviders: string[] = ['COGNITO'];

  async list() {
    return [...this.providers.values()];
  }

  async create(input: SsoProviderInput) {
    if (this.providers.has(input.name)) throw conflict('A provider with this name already exists', 'provider_exists');
    this.providers.set(input.name, { name: input.name, type: input.type, emailDomains: input.emailDomains });
  }

  async delete(name: string) {
    if (!this.providers.delete(name)) throw notFound('Provider not found');
  }

  async syncClient(providerNames: string[]) {
    this.clientProviders = ['COGNITO', ...providerNames];
  }
}

/** Re-applies the configured providers to the app client. Called by the setup custom resource. */
export async function reconcileSsoProviders(deps: Deps): Promise<void> {
  const settings = await deps.settings();
  if (!settings.licenseKey || settings.sso.providers.length === 0) return;
  const license = verifyLicense(settings.licenseKey, deps.now());
  if (!license.ok || !license.info.features.includes('sso')) return;
  const existing = new Set((await deps.idp.list()).map((p) => p.name));
  await deps.idp.syncClient(settings.sso.providers.map((p) => p.name).filter((n) => existing.has(n)));
}
