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
import {Instance, ContainerImage, CpuUnit, MemoryUnit} from 'dssim-core';

import {BaseInstance} from '../BaseInstance.js';
import {KubernetesExecutor} from '../KubernetesExecutor.js';

export class DSCInstance extends BaseInstance implements Instance {
  static idsPort = 8080;
  constructor(
    public deploymentName: string,
    public readonly username: string,
    public readonly password: string,
    connectorImages: ContainerImage[],
    memoryLimit?: {value: number; unit: MemoryUnit} | undefined,
    cpuLimit?: {value: number; unit: CpuUnit}
  ) {
    super(
      deploymentName,
      connectorImages,
      [{name: 'main', path: '/api/ids/data', port: DSCInstance.idsPort}],
      memoryLimit,
      cpuLimit
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
            containers: [
              {
                name: this.deploymentName,
                image: this.containerImages[0].image,
                imagePullPolicy: 'Always',
                ports: [
                  {containerPort: DSCInstance.idsPort, name: 'restendpoint'},
                ],
                readinessProbe: {
                  failureThreshold: 20,
                  httpGet: {
                    path: '/',
                    port: DSCInstance.idsPort,
                    scheme: 'HTTPS',
                  },
                  initialDelaySeconds: 15,
                  periodSeconds: 10,
                  successThreshold: 1,
                  timeoutSeconds: 2,
                },
                env: [
                  {
                    name: 'SPRING_DATASOURCE_USERNAME',
                    value: this.username,
                  },
                  {
                    name: 'SPRING_DATASOURCE_PASSWORD',
                    value: this.password,
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
  public async deployServices(): Promise<void> {
    await KubernetesExecutor.getInstance().deployService(
      this.deploymentName,
      this.deploymentName,
      [
        /* {
            name: 'http',
            port: 8080,
            targetPort: 8080,
          },*/
        {
          name: 'https',
          port: 443,
          targetPort: DSCInstance.idsPort,
        },
      ]
    );
  }
  public async deployIngress(): Promise<void> {
    await KubernetesExecutor.getInstance().deployIngress(
      this.deploymentName,
      [
        {
          host: this.deploymentName,
          http: {
            paths: [
              {
                backend: {
                  service: {
                    name: this.deploymentName,
                    port: {number: DSCInstance.idsPort},
                  },
                },
                path: '/',
                pathType: 'Prefix',
              },
            ],
          },
        },
      ],
      {
        'nginx.ingress.kubernetes.io/backend-protocol': 'HTTPS',
      }
    );

    this.endPointUrl = `https://${this.deploymentName}`;
    this.hostname = this.deploymentName;
    this.healthCheckUrl = this.endPointUrl;
  }
}
