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
import {Instance, ContainerImage, Endpoint} from 'dssim-core';
import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class BrokerInstance extends BaseInstance implements Instance {
  private configMapName: string;
  static endpoints: Endpoint[] = [
    //{name: 'connectors', path: '/connectors', port: 8080},
    //{name: 'catalog', path: '/catalog', port: 8080},
    {name: 'broker', path: '/', port: 8080},
    {name: 'fuseki', path: '/fuseki', port: 3030},
  ];
  private readonly keyFileName = 'server.key';
  private readonly crtFileName = 'server.crt';
  private readonly jksFileName = 'isstbroker-keystore.jks';
  private readonly fusekiHostname = 'fuseki';
  private readonly fusekiPort = 3030;

  constructor(
    public deploymentName: string,
    public readonly username: string,
    public readonly password: string,
    private crtFile: string,
    private keyFile: string,
    private jksFile: string,
    connectorImages: ContainerImage[] = [
      {
        image:
          'registry.gitlab.cc-asp.fraunhofer.de/eis-ids/broker-open/core:5.0.0',
      },
      {
        image:
          'registry.gitlab.cc-asp.fraunhofer.de/eis-ids/broker-open/fuseki',
      },
    ]
  ) {
    super(deploymentName, connectorImages, BrokerInstance.endpoints);
    this.configMapName = 'edc-pre-config-' + deploymentName;
  }

  public async deployConfigMaps() {
    await KubernetesExecutor.getInstance().deployConfigMap(
      this.configMapName,
      {},
      {
        [this.keyFileName]: this.keyFile,
        [this.crtFileName]: this.crtFile,
        [this.jksFileName]: this.jksFile,
      }
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
            imagePullSecrets: Object.keys(pullSecrets).map(key => {
              return {
                name: pullSecrets[key],
              };
            }),
            volumes: [
              {emptyDir: {}, name: 'config-dir'},
              {
                configMap: {
                  name: this.configMapName,
                },
                name: this.configMapName,
              },
            ],
            containers: [
              {
                name: this.deploymentName,
                image: this.containerImages[0].image,
                ports: [{name: 'root', containerPort: 8080}],
                env: [
                  //- ELASTICSEARCH_HOSTNAME=broker-elasticsearch
                  {
                    name: 'SPARQL_ENDPOINT',
                    value: `http://${this.deploymentName}:${this.fusekiPort}/connectorData`,
                  },
                  {
                    name: 'SHACL_VALIDATION',
                    value: 'true',
                  },
                  {
                    name: 'DAPS_VALIDATE_INCOMING',
                    value: 'true',
                  },
                  {
                    name: 'IDENTITY_JAVAKEYSTORE',
                    value: `/etc/cert/${this.jksFileName}`,
                  },
                  {
                    name: 'COMPONENT_URI',
                    value: 'https://localhost/',
                  },
                  {
                    name: 'COMPONENT_CATALOGURI',
                    value: 'https://localhost/connectors/',
                  },
                  {
                    name: 'JWKS_TRUSTEDHOSTS',
                    value: 'daps.aisec.fraunhofer.de,omejdn',
                  },
                ],
                volumeMounts: [
                  {
                    name: 'config-dir',
                    mountPath: '/etc/cert',
                  },
                ],
              },
              {
                name: this.fusekiHostname,
                image: this.containerImages[1].image,
                ports: [{containerPort: this.fusekiPort, name: 'fuseki'}],
              },
            ],
          },
        },
      },
      this.memoryLimit,
      this.cpuLimit
    );
  }

  async deployIngress(): Promise<void> {
    try {
      await KubernetesExecutor.getInstance().deployIngress(
        this.deploymentName + '-admin',
        [
          {
            host: this.deploymentName,
            http: {
              paths: this.endpoints.map(e => {
                return {
                  backend: {
                    service: {
                      name: this.deploymentName,
                      port: {number: e.port},
                    },
                  },
                  path: e.path,
                  pathType: 'Prefix',
                };
              }),
            },
          },
        ],
        {
          //'nginx.ingress.kubernetes.io/backend-protocol': 'HTTPS',
          'nginx.ingress.kubernetes.io/ssl-redirect': 'false',
        }
      );
    } catch (error) {
      console.log(error);
    }

    this.endPointUrl = `https://${this.deploymentName}`;
    this.hostname = this.deploymentName;
    this.healthCheckUrl = `${this.endPointUrl}`;
  }
}
