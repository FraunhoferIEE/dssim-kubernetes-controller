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
import {KubernetesExecutor} from '../../KubernetesExecutor.js';

export class LoggingPipe {
  public deploy = async (lokiClusterUrl: string): Promise<void> => {
    const flowName = 'dssim-loki-output-generated';
    const outputName = 'dssim-loki-output-generated';
    await this.deployBanzaiCloudFlow(flowName, outputName);

    // Muss eine URL sein, die von einem anderen Namespace aufgelöst werden kann! (fluentd läuft nicht im DSSIM Namespace)
    await this.deployBanzaiCloudOutput(outputName, lokiClusterUrl);
  };

  private async deployBanzaiCloudOutput(
    name: string,
    lokiUrl: string
  ): Promise<void> {
    let lokiSecretName: string | undefined = undefined;

    if (process.env.LOKI_USERNAME && process.env.LOKI_PASSWORD) {
      lokiSecretName = 'lokisecret';
      await KubernetesExecutor.getInstance().deployOpaqueSecret(
        lokiSecretName,
        {
          username: process.env.LOKI_USERNAME,
          password: process.env.LOKI_PASSWORD,
        }
      );
    }

    await KubernetesExecutor.getInstance().deployCustomObject(
      'logging.banzaicloud.io',
      'v1beta1',
      'outputs',
      {
        apiVersion: 'logging.banzaicloud.io/v1beta1',
        kind: 'Output',
        metadata: {
          name: name,
          labels: {},
        },
        spec: {
          loki: {
            buffer: {
              timekey: '1m',
              timekey_use_utc: true,
              timekey_wait: '30s',
              timekey_zone: 'Europe/Berlin',
            },
            configure_kubernetes_labels: true,
            extract_kubernetes_labels: true,
            url: lokiUrl,
            password: lokiSecretName
              ? {
                  valueFrom: {
                    secretKeyRef: {
                      key: 'password',
                      name: lokiSecretName,
                    },
                  },
                }
              : undefined,
            username: lokiSecretName
              ? {
                  valueFrom: {
                    secretKeyRef: {
                      key: 'username',
                      name: lokiSecretName,
                    },
                  },
                }
              : undefined,
          },
        },
      }
    );
    //console.log(result);
  }

  private async deployBanzaiCloudFlow(
    name: string,
    outputRef: string
  ): Promise<void> {
    await KubernetesExecutor.getInstance().deployCustomObject(
      'logging.banzaicloud.io',
      'v1beta1',
      'flows',
      {
        apiVersion: 'logging.banzaicloud.io/v1beta1',
        kind: 'Flow',
        metadata: {
          name: name,
          labels: {},
        },
        spec: {
          localOutputRefs: [outputRef],
          match: [
            {
              select: {
                labels: {
                  group: KubernetesExecutor.getInstance().groupLabel,
                },
              },
            },
          ],
        },
      }
    );
  }
}
