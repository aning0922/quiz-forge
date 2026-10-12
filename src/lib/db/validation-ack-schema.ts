import "server-only";
/** Exact frozen 0012 helper bodies; attributes alone cannot identify the ACK protocol. */
export const validationAckFunctionHashes: Readonly<Record<string, string>> = {
  "qf.validation_file_stop_protocol()":
    "6c93e6e80abd2e60faf5e4f6247150e9ede92973be16f0d5ff43b748119f14c9",
  "qf.validation_file_stop_proof_valid(jsonb,uuid,jsonb)":
    "7a19b33d5aa36d1baccb4b6c6e62001043856a623dd03dd9c716e2d9a2d12f94",
  "qf.validation_file_stop_controls_valid(text,uuid,text,text)":
    "2a5910e875cb5b94e2b6c679fa3214ea29e6c24e653c37aa952a3184c8638e14",
  "qf.protect_validation_file_stop_ack()":
    "08076af27da2c017ebb5777ee241daafda63e877d018e5f4a9dd0e4ec755592c",
  "qf.validation_attempts_valid(text,integer,uuid,bigint)":
    "2a0bf4bcdda05964e145ce6c3a178a549bb6672534b04dc5a816c33b6ae7c2c7",
  "qf.protect_validation()":
    "b0943587540e4737ce009e959b0220523d3a9e34f7c19d14e2dd5bc29b525134",
};
