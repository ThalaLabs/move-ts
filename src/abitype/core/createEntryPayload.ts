import { BCS, TxnBuilderTypes, TypeTagParser } from "aptos";
import { ensureBigInt, ensureBoolean, ensureNumber } from "../ensureTypes";
import { ABIRoot } from "../types";
import { EntryFunctionName, EntryPayload, EntryRequestPayload, FunctionMap } from "../types/common";

export function createEntryPayload<
    T extends ABIRoot,
    TFuncName extends EntryFunctionName<T>,
    TFunc extends FunctionMap<T>[TFuncName]
>(
    abi: T,
    payload: EntryRequestPayload<T, TFuncName, TFunc>
): EntryPayload {
    // TODO: remove unused variables
    const fnAbi = abi.exposed_functions.filter(f => f.name === payload.function)[0];
    const typeArguments: string[] = payload.type_arguments as any[];
    const valArguments: any[] = payload.arguments as any[];
    const abiArgs = fnAbi.params[0] === '&signer'
        ? (fnAbi.params as string[]).slice(1)
        : fnAbi.params as string[];

    // Validations
    if (fnAbi === undefined) throw new Error(`Function ${payload.function} not found in ABI`);
    if (abiArgs.length !== valArguments.length) throw new Error(`Function ${payload.function} expects ${fnAbi.params.length} arguments, but ${payload.arguments.length} were provided`);
    if (fnAbi.generic_type_params.length !== typeArguments.length) throw new Error(`Function ${payload.function} expects ${fnAbi.generic_type_params.length} type arguments, but ${payload.type_arguments.length} were provided`);

    // TODO: make entryRequest lazy
    return {
        rawPayload: {
            ...payload,
            function: `${abi.address}::${abi.name}::${payload.function}`,
        } as any,
        entryRequest: TxnBuilderTypes.EntryFunction.natural(
            `${abi.address}::${abi.name}`, // module id
            payload.function, // function name
            typeArguments // type arguments
                .map((arg) => {
                    // The StructTag.fromString not support nested struct tag before aptos@1.8.4.
                    // So we use the TypeTagParser to parse the string literal into a TypeTagStruct
                    // For better compatibility.
                    // The next line of code is simpler, but not compatible with aptos below 1.8.3.
                    // return new TxnBuilderTypes.TypeTagStruct(TxnBuilderTypes.StructTag.fromString(arg));

                    // Use the TypeTagParser to parse the string literal into a TypeTagStruct
                    const typeTagStruct = new TypeTagParser(arg).parseTypeTag() as TxnBuilderTypes.TypeTagStruct;

                    // Convert and return as a StructTag
                    return new TxnBuilderTypes.TypeTagStruct(new TxnBuilderTypes.StructTag(
                        typeTagStruct.value.address,
                        typeTagStruct.value.module_name,
                        typeTagStruct.value.name,
                        typeTagStruct.value.type_args,
                    ));
                }),
            valArguments.map( // arguments
                (arg, i) => {
                    const type = abiArgs[i];
                    const serializer = new BCS.Serializer();
                    argToBCS(type, arg, serializer);
                    return serializer.getBytes();
                }
            )
        )
    };
}


function argToBCS(type: string, arg: any, serializer: BCS.Serializer) {

    const regex = /vector<([^]+)>/;
    const match = type.match(regex);
    if (match) { // It's vector
        const innerType = match[1];
        if (innerType === 'u8') {
            if (arg instanceof Uint8Array) { // TODO: add type support for Uint8Array
                serializer.serializeBytes(arg);
                return;
            }

            if (typeof arg === "string") { // TODO: add type support for string
                serializer.serializeStr(arg);
                return;
            }
        }

        if (!Array.isArray(arg)) {
            throw new Error("Invalid vector args.");
        }

        serializer.serializeU32AsUleb128(arg.length);

        arg.forEach((arg) => argToBCS(innerType, arg, serializer));
        return;
    }

    // TODO: it's struct

    switch (type) { // It's primitive
        case 'bool':
            serializer.serializeBool(ensureBoolean(arg));
            break;
        case 'address':
            TxnBuilderTypes.AccountAddress.fromHex(arg as string).serialize(serializer);
            break;
        case 'u8':
            serializer.serializeU8(ensureNumber(arg));
            break;
        case 'u16':
            serializer.serializeU16(ensureNumber(arg));
            break;
        case 'u32':
            serializer.serializeU32(ensureNumber(arg));
            break;
        case 'u64':
            serializer.serializeU64(ensureBigInt(arg));
            break;
        case 'u128':
            serializer.serializeU128(ensureBigInt(arg));
            break;
        case 'u256':
            serializer.serializeU256(ensureBigInt(arg));
            break;
        case '0x1::string::String':
            serializer.serializeStr(arg as string);
            break;
        default:
            throw new Error(`type "${type}" not supported`);
    }
}
