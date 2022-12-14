import { AsyncResult } from "./result"
import { StashProfile } from "./stash-profile"
import { OauthAuthenticationInfo } from "./auth/oauth-utils"
import { AuthenticationFailure } from "./errors"

export type Auth0AccessToken = {
  kind: "Auth0-AccessToken"
  accessToken: string
}

export type Auth0DeviceCode = {
  kind: "Auth0-DeviceCode"
  host: string
  clientId: string
}

export type Auth0Machine2Machine = {
  kind: "Auth0-Machine2Machine"
  host: string
  clientId: string
  clientSecret: string
}

export type ConsoleAccessKey = {
  kind: "Console-AccessKey"
  accessKey: string
}

export type OAuthCallback = {
  kind: "OAuthCallback"
  callback: () => AsyncResult<OauthAuthenticationInfo, AuthenticationFailure>
}

export type IdentityProvider =
  | Auth0AccessToken
  | Auth0DeviceCode
  | Auth0Machine2Machine
  | OAuthCallback
  | ConsoleAccessKey

export type KmsKeySource = {
  arn: string
  namingKey: string
  region: string
}

export type FederatedAwsCredentialsSource = {
  kind: "Federated"
  roleArn: string
  region: string
}

export type ExplicitAwsCredentialsSource = {
  kind: "Explicit"
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
}

export type AwsCredentialsSource = FederatedAwsCredentialsSource | ExplicitAwsCredentialsSource

export type KMSKey = {
  kind: "AWS-KMS"
  key: KmsKeySource
  awsCredentials: AwsCredentialsSource
}

export type StashConfiguration = {
  readonly service: {
    readonly host: string
    readonly port?: number
    readonly workspace: string
  }
  readonly identityProvider: IdentityProvider
  readonly keyManagement: KMSKey
}

export function loadProfileFromEnv(): StashProfile {
  return new StashProfile(`${getVar("CS_SERVICE_FQDN")}-${getVar("CS_WORKSPACE")}`, {
    service: {
      workspace: getVar("CS_WORKSPACE"),
      host: getVar("CS_SERVICE_FQDN"),
      port: parseInt(getVar("CS_SERVICE_PORT", "443")),
    },
    identityProvider:
      getVar("CS_ACCESS_TOKEN", "") === ""
        ? getVar("CS_IDP_CLIENT_SECRET", "") === ""
          ? {
              kind: "Auth0-DeviceCode",
              host: getVar("CS_IDP_HOST"),
              clientId: getVar("CS_IDP_CLIENT_ID"),
            }
          : getVar("CS_IDP_CLIENT_ID", "") === ""
          ? {
              kind: "Console-AccessKey",
              accessKey: getVar("CS_IDP_CLIENT_SECRET"),
            }
          : {
              kind: "Auth0-Machine2Machine",
              host: getVar("CS_IDP_HOST"),
              clientId: getVar("CS_IDP_CLIENT_ID"),
              clientSecret: getVar("CS_IDP_CLIENT_SECRET"),
            }
        : {
            kind: "Auth0-AccessToken",
            accessToken: getVar("CS_ACCESS_TOKEN"),
          },
    keyManagement: {
      kind: "AWS-KMS",
      key: {
        arn: getVar("CS_KMS_KEY_ARN"),
        namingKey: getVar("CS_NAMING_KEY"),
        region: getVar("CS_KMS_KEY_REGION"),
      },
      awsCredentials:
        getVar("CS_KMS_FEDERATION_ROLE_ARN", "") === ""
          ? {
              kind: "Explicit",
              accessKeyId: getVar("CS_AWS_ACCESS_KEY_ID"),
              secretAccessKey: getVar("CS_AWS_SECRET_ACCESS_KEY"),
              sessionToken: getVar("CS_AWS_SESSION_TOKEN", ""),
              region: getVar("CS_AWS_REGION"),
            }
          : {
              kind: "Federated",
              roleArn: getVar("CS_KMS_FEDERATION_ROLE_ARN"),
              region: getVar("CS_AWS_REGION"),
            },
    },
  })
}

function getVar(envVar: string, fallback?: string): string {
  const value = process.env[envVar]
  if (typeof value != "undefined") {
    return value
  } else {
    if (typeof fallback != "undefined") {
      return fallback
    } else {
      throw new Error(`"missing configuration: ${envVar}`)
    }
  }
}
