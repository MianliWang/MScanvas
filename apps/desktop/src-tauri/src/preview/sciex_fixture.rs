//! The bytes a lawful SCIEX acquisition fixture is made of.
//!
//! Shared rather than spelled once per test module. A compound-file header is
//! not a value anyone should write twice: two copies would be two things to
//! keep in step with the crate's own recognition rule, and a copy that drifted
//! would quietly stop standing in for an acquisition while still passing.

/// The directory entries the family's recognition looks for.
pub(crate) const SCIEX_MARKERS: [&str; 4] = [
    "SampleSubtree",
    "MethodSubtree",
    "SampleTable",
    "MassSpecMethod",
];

const COMPOUND_FILE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// A compound file under the geometry a real `.wiff` declares.
///
/// Version 4 with 4096-byte sectors, because five entries do not fit in the
/// 512-byte directory sector the LabSolutions fixture uses -- and because that
/// is what all three lawful fixtures declare.
pub(crate) fn wiff_container_bytes(entries: &[&str]) -> Vec<u8> {
    const SECTOR: usize = 4096;
    let mut bytes = vec![0_u8; SECTOR * 2];
    bytes[..8].copy_from_slice(&COMPOUND_FILE_MAGIC);
    bytes[26..28].copy_from_slice(&4_u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&[0xFE, 0xFF]);
    bytes[30..32].copy_from_slice(&12_u16.to_le_bytes());
    bytes[48..52].copy_from_slice(&0_u32.to_le_bytes());

    let named = std::iter::once("Root Entry").chain(entries.iter().copied());
    for (index, name) in named.enumerate() {
        let at = SECTOR + index * 128;
        let units: Vec<u16> = name.encode_utf16().collect();
        for (unit, slot) in units.iter().zip(bytes[at..].chunks_exact_mut(2)) {
            slot.copy_from_slice(&unit.to_le_bytes());
        }
        let declared = u16::try_from(units.len() * 2 + 2).expect("a short entry name");
        bytes[at + 64..at + 66].copy_from_slice(&declared.to_le_bytes());
        bytes[at + 66] = if index == 0 { 5 } else { 2 };
    }
    bytes
}

/// The companion half, with a caller-chosen payload so one member can be
/// rewritten on its own.
pub(crate) fn scan_companion_bytes(payload: &str) -> Vec<u8> {
    let mut bytes = vec![
        0x82, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x11, 0x82, 0x05, 0x00, 0x00, 0x01, 0x00,
        0x00, 0x00,
    ];
    bytes.extend_from_slice(payload.as_bytes());
    bytes
}
