/*
 * Copyright 2023 Fraunhofer IEE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Contributors:
 *       Michel Otto - initial implementation
 *
 */
import {ContainerImage, Instance} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class DapsInstance extends BaseInstance implements Instance {
  private OMEJDN_PROTOCOL = 'https';
  private OMEJDN_DOMAIN = 'daps';
  private OMEJDN_PATH = '/';

  private containerName = 'daps-container';

  private dapsUiContainerName = 'daps-ui-container';

  private configMapName = 'daps-pre-config';
  private omejdnkeyname = 'omejdnkeys';

  constructor(
    public deploymentName: string,
    public readonly username: string,
    public readonly password: string,
    connectorImages: ContainerImage[] = [
      {
        image: 'ghcr.io/fraunhofer-aisec/omejdn-server:1.7.1',
      },
      {image: 'ghcr.io/fraunhofer-aisec/omejdn-ui:dev'},
    ]
  ) {
    super(deploymentName, connectorImages, []);
  }

  async deploySecrets() {
    if (!process.env.OMEJDNKEY || !process.env.CONNECTORCERT)
      throw Error('Environment variables for Daps are not set.');
    await KubernetesExecutor.getInstance().deployOpaqueSecret(
      this.omejdnkeyname,
      {
        'connector1.cert': process.env.CONNECTORCERT!,
        'omejdn.key': process.env.OMEJDNKEY!,
      }
    );
  }

  async deployConfigMaps() {
    await KubernetesExecutor.getInstance().deployConfigMap(this.configMapName, {
      'clients.yml': `---
  - client_id: adminUI
    client_name: Omejdn Admin UI
    client_uri: https://dapsui
    logo_uri: https://dapsui/assets/img/fhg.jpg
    grant_types: authorization_code
    software_id: Omejdn Admin UI
    software_version: 0.0.0
    token_endpoint_auth_method: none
    redirect_uris: https://dapsui
    post_logout_redirect_uris: https://dapsui
    scope:
    - openid
    - omejdn:admin
    - omejdn:write
    - omejdn:read
    attributes: []
  - client_id: CB:BA:EC:89:5A:4F:92:05:59:A7:1F:BF:AE:0D:5F:B1:92:44:5F:77:keyid:CB:BA:EC:89:5A:4F:92:05:59:A7:1F:BF:AE:0D:5F:B1:92:44:5F:77
    client_name: connector1
    grant_types: client_credentials
    token_endpoint_auth_method: private_key_jwt
    scope: idsc:IDS_CONNECTOR_ATTRIBUTES_ALL
    attributes:
    - key: idsc
    value: IDS_CONNECTOR_ATTRIBUTES_ALL
    - key: securityProfile
    value: idsc:BASE_SECURITY_PROFILE
    - key: referringConnector
    value: http://connector1.demo
    - key: "@type"
    value: ids:DatPayload
    - key: "@context"
    value: https://w3id.org/idsa/contexts/context.jsonld
    - key: transportCertsSha256
    value: 0c8956f59167e90ed6ae3d60e19c5bab7b517a96221e63f2fb382ad5d5ad7231`,

      'omejdn.yml': `---
  user_backend_default: yaml
  issuer: http://daps/
  front_url: http://daps/
  bind_to: 0.0.0.0:4567
  environment: development
  openid: true
  default_audience: idsc:IDS_CONNECTORS_ALL
  accept_audience: idsc:IDS_CONNECTORS_ALL
  access_token:
    expiration: 3600
    algorithm: RS256
  id_token:
    expiration: 3600
    algorithm: RS256`,

      'scope_mapping.yml': `---
  idsc:IDS_CONNECTOR_ATTRIBUTES_ALL:
  - securityProfile
  - referringConnector
  - "@type"
  - "@context"
  - transportCertsSha256`,
    });
  }

  public async deployIngress(): Promise<void> {
    await this.deployBEIngress();
    await this.deployUIIngress();
  }

  private deployUIIngress() {
    return KubernetesExecutor.getInstance().deployIngress(
      this.deploymentName + 'ui',
      [
        {
          host: this.deploymentName + 'ui',
          http: {
            paths: [
              {
                backend: {
                  service: {
                    name: this.deploymentName,
                    port: {number: 80},
                  },
                },
                path: '/',
                pathType: 'Prefix',
              },
            ],
          },
        },
      ]
    );
  }

  private deployBEIngress() {
    return KubernetesExecutor.getInstance().deployIngress(this.deploymentName, [
      {
        host: this.deploymentName,
        http: {
          paths: [
            {
              backend: {
                service: {
                  name: this.deploymentName,
                  port: {number: 4567},
                },
              },
              path: '/',
              pathType: 'Prefix',
            },
          ],
        },
      },
    ]);
  }

  public async deployServices(): Promise<void> {
    await KubernetesExecutor.getInstance().deployService(
      this.deploymentName,
      this.deploymentName,
      [
        {
          name: 'daps',
          port: 4567,
          targetPort: 4567,
        },
        {
          name: 'dapsui',
          port: 80,
          targetPort: 80,
        },
      ]
    );
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    await KubernetesExecutor.getInstance().deployApp(
      this.deploymentName,
      {
        selector: {
          matchLabels: {
            app: this.deploymentName,
          },
        },
        replicas: 1,
        template: {
          metadata: {
            labels: {
              app: this.deploymentName,
            },
          },
          spec: {
            volumes: [
              {emptyDir: {}, name: 'config-dir'},
              {emptyDir: {}, name: 'keys-dir'},
              {
                configMap: {
                  name: this.configMapName,
                },
                name: 'pre-config',
              },
              {
                secret: {
                  secretName: this.omejdnkeyname,
                },
                name: 'pre-keys',
              },
            ],
            initContainers: [
              {
                name: 'init-myservice',
                image: 'busybox:latest',
                command: [
                  'sh',
                  '-c',
                  'cp /opt/preconfig/* /opt/config/; mkdir /opt/keys/omejdn; cp /opt/prekeys/omejdn.key /opt/keys/omejdn/; mkdir /opt/keys/clients; cp /opt/prekeys/connector1.cert /opt/keys/clients/CB:BA:EC:89:5A:4F:92:05:59:A7:1F:BF:AE:0D:5F:B1:92:44:5F:77:keyid:CB:BA:EC:89:5A:4F:92:05:59:A7:1F:BF:AE:0D:5F:B1:92:44:5F:77.cert',
                ],
                volumeMounts: [
                  {
                    name: 'config-dir',
                    mountPath: '/opt/config',
                  },
                  {
                    name: 'pre-config',
                    mountPath: '/opt/preconfig',
                  },
                  {
                    name: 'keys-dir',
                    mountPath: '/opt/keys',
                  },
                  {
                    name: 'pre-keys',
                    mountPath: '/opt/prekeys',
                  },
                ],
              },
            ],
            imagePullSecrets: pullSecrets
              ? [
                  {
                    name: pullSecrets[
                      Object.keys(this.containerImages[0].pullSecret!)[0]
                    ],
                  },
                ]
              : [],
            containers: [
              {
                name: this.containerName,
                image: this.containerImages[0].image,
                imagePullPolicy: 'Always',
                ports: [{containerPort: 4567, name: 'restendpoint'}],
                env: [
                  {
                    name: 'OMEJDN_ISSUER',
                    value: `${this.OMEJDN_PROTOCOL}://${this.OMEJDN_DOMAIN}${this.OMEJDN_PATH}`,
                  },
                  {
                    name: 'OMEJDN_FRONT_URL',
                    value: `${this.OMEJDN_PROTOCOL}://${this.OMEJDN_DOMAIN}${this.OMEJDN_PATH}`,
                  },
                  {
                    name: 'OMEJDN_OPENID',
                    value: 'true',
                  },
                  {
                    name: 'OMEJDN_ENVIRONMENT',
                    value: 'development',
                  },
                  {
                    name: 'OMEJDN_ACCEPT_AUDIENCE',
                    value: 'idsc:IDS_CONNECTORS_ALL',
                  },
                  {
                    name: 'OMEJDN_DEFAULT_AUDIENCE',
                    value: 'idsc:IDS_CONNECTORS_ALL',
                  },
                  {
                    name: 'OMEJDN_ADMIN',
                    value: `${this.username}:${this.password}`,
                  },
                ],
                volumeMounts: [
                  {
                    name: 'config-dir',
                    mountPath: '/opt/config',
                  },
                  {
                    name: 'keys-dir',
                    mountPath: '/opt/keys',
                  },
                ],
              },
              {
                name: this.dapsUiContainerName,
                image: this.containerImages[1].image,
                ports: [{containerPort: 80, name: 'restendpoint'}],
                env: [
                  {
                    name: 'OIDC_ISSUER',
                    value: `${this.OMEJDN_PROTOCOL}://${this.OMEJDN_DOMAIN}${this.OMEJDN_PATH}`,
                  },
                  {
                    name: 'API_URL',
                    value: `${this.OMEJDN_PROTOCOL}://${this.OMEJDN_DOMAIN}${this.OMEJDN_PATH}/api/v1`,
                  },
                  {
                    name: 'CLIENT_ID',
                    value: 'adminUI',
                  },
                ],
              },
            ],
          },
        },
      },
      this.memoryLimit,
      this.cpuLimit
    );
  }
}
