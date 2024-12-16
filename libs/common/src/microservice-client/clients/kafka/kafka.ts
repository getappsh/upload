import { ClientProvider, Transport } from "@nestjs/microservices";
import { MicroserviceType } from "../../microservice-client.interface";
import { getKafkaConnection } from "./connection";

export function getKafkaClientConfig(type: MicroserviceType): ClientProvider {
  switch (type){
    case MicroserviceType.DELIVERY:
      return kafkaDeliveryConfig()
    case MicroserviceType.DEPLOY:
      return kafkaDeployConfig()
    case MicroserviceType.DISCOVERY:
      return kafkaDiscoveryConfig()
    case MicroserviceType.OFFERING:
      return kafkaOfferingConfig()
    case MicroserviceType.PROJECT_MANAGEMENT:
      return kafkaProjectManagementConfig()
    case MicroserviceType.UPLOAD:
      return kafkaUploadConfig()
    case MicroserviceType.GET_MAP:
      return kafkaGetMapConfig()
    case MicroserviceType.DEVICE:
      return kafkaDeviceConfig()
    case MicroserviceType.MICRO_DISCOVERY:
      return kafkaDiscoverMicroConfig()
  }
}

export const KAFKA_DELIVERY_CLIENT_ID="getapp-delivery"
export const KAFKA_DELIVERY_GROUP_ID="getapp-delivery-consumer"
const kafkaDeliveryConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_DELIVERY_CLIENT_ID),
        consumer: {
            groupId: KAFKA_DELIVERY_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}


export const KAFKA_DEPLOY_CLIENT_ID="getapp-deploy"
export const KAFKA_DEPLOY_GROUP_ID="getapp-deploy-consumer"
const kafkaDeployConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_DEPLOY_CLIENT_ID),
        consumer: {
            groupId: KAFKA_DEPLOY_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_DISCOVERY_CLIENT_ID="getapp-discovery"
export const KAFKA_DISCOVERY_GROUP_ID="getapp-discovery-consumer"
const kafkaDiscoveryConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_DISCOVERY_CLIENT_ID),
        consumer: {
            groupId: KAFKA_DISCOVERY_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}


export const KAFKA_OFFERING_CLIENT_ID="getapp-offering"
export const KAFKA_OFFERING_GROUP_ID="getapp-offering-consumer"
const kafkaOfferingConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_OFFERING_CLIENT_ID),
        consumer: {
            groupId: KAFKA_OFFERING_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_PROJECT_MANAGEMENT_CLIENT_ID="getapp-project-management"
export const KAFKA_PROJECT_MANAGEMENT_GROUP_ID="getapp-project-management-consumer"
const kafkaProjectManagementConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_PROJECT_MANAGEMENT_CLIENT_ID),
        consumer: {
            groupId: KAFKA_PROJECT_MANAGEMENT_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_UPLOAD_CLIENT_ID="getapp-upload"
export const KAFKA_UPLOAD_GROUP_ID="getapp-upload-consumer"          
const kafkaUploadConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_UPLOAD_CLIENT_ID),
        consumer: {
            groupId: KAFKA_UPLOAD_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_GET_MAP_CLIENT_ID="getapp-get-map"
export const KAFKA_GET_MAP_GROUP_ID="getapp-map-device-consumer"
const kafkaGetMapConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_GET_MAP_CLIENT_ID),
        consumer: {
            groupId: KAFKA_GET_MAP_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_MAP_DEVICE_CLIENT_ID="getapp-map-device"
export const KAFKA_MAP_DEVICE_GROUP_ID="getapp-map-device-consumer.cancel"       
const kafkaDeviceConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_MAP_DEVICE_CLIENT_ID),
        consumer: {
            groupId: KAFKA_MAP_DEVICE_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}

export const KAFKA_DISCOVERY_MICRO_CLIENT_ID="getapp-discovery-micro"
export const KAFKA_DISCOVERY_MICRO_GROUP_ID="getapp-discovery-micro-consumer" 
const kafkaDiscoverMicroConfig = (): ClientProvider => {
  return {
    transport: Transport.KAFKA,
    options: {
        client: getKafkaConnection(KAFKA_DISCOVERY_MICRO_CLIENT_ID),
        consumer: {
            groupId: KAFKA_DISCOVERY_MICRO_GROUP_ID
        },
        run: {
          partitionsConsumedConcurrently: Number(process.env.CONSUME_CONCURRENT ?? 100)
        }
    }
  }
}