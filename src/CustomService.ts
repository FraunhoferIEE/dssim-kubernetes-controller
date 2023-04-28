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
import {ContainerImage, Endpoint, ReadinessProbe} from 'dssim-core';
import {BaseInstance} from './BaseInstance.js';
import {KubernetesExecutor} from './KubernetesExecutor.js';

export class CustomService extends BaseInstance {
  constructor(
    public name: string,
    public images: ContainerImage[],
    public endpoints: Endpoint[],
    public readinessProbes?: ReadinessProbe[]
  ) {
    super(name, images, endpoints);
  }

  public async deployApp(pullSecrets: {[key: string]: string}): Promise<void> {
    await KubernetesExecutor.getInstance().deployApp(
      this.name,
      {
        selector: {
          matchLabels: {
            app: this.name,
          },
        },
        replicas: 1,
        template: {
          metadata: {
            labels: {
              app: this.name,
            },
          },
          spec: {
            imagePullSecrets: Object.keys(pullSecrets).map(key => {
              return {
                name: pullSecrets[key],
              };
            }),
            containers: this.images.map((image, index) => {
              return {
                name: this.name + index,
                image: image.image,
                ports: this.endpoints.map(endpoint => {
                  return {containerPort: endpoint.port, name: endpoint.name};
                }),
                imagePullPolicy: 'Always',
                readinessProbe:
                  this.readinessProbes && this.readinessProbes.length > index
                    ? this.readinessProbes[index]
                    : undefined,
              };
            }),
          },
        },
      },
      this.memoryLimit,
      this.cpuLimit
    );
  }
}
