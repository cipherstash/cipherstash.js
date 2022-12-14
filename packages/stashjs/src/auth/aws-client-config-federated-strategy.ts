import { AssumeRoleWithWebIdentityCommandOutput, STS } from "@aws-sdk/client-sts"
import { OauthAuthenticationInfo } from "./oauth-utils"
import { AuthStrategy } from "./auth-strategy"
import { FederatedAwsCredentialsSource } from "../stash-config"
import { AuthenticationFailure, AWSFederationFailure, wrap } from "../errors"
import { AsyncResult, Ok, Err } from "../result"
import { AWSClientConfig } from "./aws-client-config"
import { Memo } from "./auth-strategy"
import { retryPromise } from "../retry-promise"
import { isObject } from "../guards"

export class AWSClientConfigFederatedStrategy implements AuthStrategy<AWSClientConfig> {
  private awsConfig!: AWSClientConfig
  private expiryDate: Date = new Date(0)

  constructor(
    private credSource: FederatedAwsCredentialsSource,
    private tokenGenerator: Memo<OauthAuthenticationInfo>
  ) {}

  public stillFresh(): boolean {
    return !this.needsRefresh()
  }

  public async getAuthenticationDetails(): AsyncResult<AWSClientConfig, AuthenticationFailure> {
    if (this.needsRefresh()) {
      const result = await this.acquireAwsConfig()
      if (!result.ok) {
        return Err(result.error)
      }
    }

    return Ok(this.awsConfig)
  }

  private needsRefresh() {
    return this.expiryDate.getTime() - Date.now() < EXPIRY_BUFFER_MILLIS
  }

  private async acquireAwsConfig(): AsyncResult<void, AuthenticationFailure> {
    const tokenResult = await this.tokenGenerator.freshValue()
    if (!tokenResult.ok) {
      return Err(tokenResult.error)
    }

    const client = new STS({ region: this.credSource.region })

    try {
      const { Credentials: credentials } = await retryPromise(
        () =>
          client.assumeRoleWithWebIdentity({
            RoleArn: this.credSource.roleArn,
            WebIdentityToken: tokenResult.value.accessToken,
            // TODO: This should possibly be the user ID (sub from the access token)
            RoleSessionName: "stash-client",
            // Sometimes this method fails with an InvalidIdentityToken error that can happen when
            // we get rate limited. It should be safe to retry.
          }),
        { retryOn: e => isObject(e) && e["name"] === "InvalidIdentityToken" }
      )

      if (credentials) {
        this.awsConfig = this.toAwsConfig(this.credSource.region, credentials)
        this.expiryDate = credentials.Expiration!
        return Ok()
      } else {
        return Err(AuthenticationFailure(AWSFederationFailure(undefined, "STS Token Exchange failed")))
      }
    } catch (error) {
      return Err(AuthenticationFailure(AWSFederationFailure(wrap(error))))
    }
  }

  private toAwsConfig(
    region: string,
    credentials: AssumeRoleWithWebIdentityCommandOutput["Credentials"]
  ): AWSClientConfig {
    const { AccessKeyId: accessKeyId, SecretAccessKey: secretAccessKey, SessionToken: sessionToken } = credentials!

    return {
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        sessionToken,
      },
      region,
    }
  }
}

const EXPIRY_BUFFER_MILLIS = 5 * 60 * 1000
