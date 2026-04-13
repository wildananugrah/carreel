import type { Alert, AlertType } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface CreateAlertDTO {
  inspectionId: string;
  alertType: AlertType;
  message: string;
}

export interface IAlertRepository {
  create(scope: UserScope, data: CreateAlertDTO): Promise<Alert>;
}
