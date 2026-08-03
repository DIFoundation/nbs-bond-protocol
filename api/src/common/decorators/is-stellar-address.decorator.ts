import { registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: string) {
          return (
            typeof value === 'string' &&
            StrKey.isValidEd25519PublicKey(value)
          );
        },
        defaultMessage: () =>
          'Invalid Stellar public key (must be a valid ed25519 address)',
      },
    });
  };
}
