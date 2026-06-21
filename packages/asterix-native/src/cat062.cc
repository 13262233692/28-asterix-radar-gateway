#include "asterix_decoder.h"
#include <cstring>
#include <vector>

namespace asterix {

static std::vector<uint8_t> parseFSPECCat062(BitReader& br) {
    std::vector<uint8_t> fspec;
    while (true) {
        uint8_t octet = static_cast<uint8_t>(br.readBits(8));
        fspec.push_back(octet);
        if (!(octet & 0x01)) break;
    }
    return fspec;
}

static bool fspecHasItemCat062(const std::vector<uint8_t>& fspec, size_t frn) {
    if (frn == 0) return false;
    size_t octet_idx = (frn - 1) / 7;
    size_t bit_idx = 7 - ((frn - 1) % 7);
    if (octet_idx >= fspec.size()) return false;
    return (fspec[octet_idx] & (1 << bit_idx)) != 0;
}

std::vector<TrackPoint> decodeCat062(const uint8_t* data, size_t len) {
    std::vector<TrackPoint> result;
    if (len < 5) return result;

    BitReader br(data + 1, len - 1);
    uint16_t len_field = br.readU16(16);
    if (len_field > len) return result;

    while (!br.eof()) {
        std::vector<uint8_t> fspec = parseFSPECCat062(br);

        TrackPoint tp{};
        tp.has_mode_s = false;
        tp.has_position = false;
        tp.has_altitude = false;
        tp.ground_speed = 0;
        tp.track_angle = 0;

        if (fspecHasItemCat062(fspec, 1)) {
            tp.track_number = br.readU32(24);
        }

        if (fspecHasItemCat062(fspec, 2)) {
            uint8_t ext = br.readU8(8);
        }

        if (fspecHasItemCat062(fspec, 3)) {
            tp.time_of_day = static_cast<double>(br.readU32(24)) / 128.0;
        }

        if (fspecHasItemCat062(fspec, 4)) {
            tp.mode_s_address = br.readU32(24);
            tp.has_mode_s = true;
        }

        if (fspecHasItemCat062(fspec, 5)) {
            uint8_t conf_lvl = br.readU8(4);
            uint8_t cn = br.readU8(2);
            uint8_t cd = br.readU8(2);
        }

        if (fspecHasItemCat062(fspec, 6)) {
            uint8_t dcr = br.readU8(2);
            uint8_t gho = br.readU8(1);
            uint8_t cst = br.readU8(1);
            uint8_t pdl = br.readU8(1);
            br.skipBits(3);
        }

        bool has_wgs_lat = false, has_wgs_lon = false;
        if (fspecHasItemCat062(fspec, 7)) {
            br.skipBits(4);
            uint8_t rep = br.readU8(4);
            for (uint8_t r = 0; r < rep + 1; r++) {
                uint16_t sac = br.readU16(16);
                uint8_t sic = br.readU8(8);
                uint8_t srd = br.readU8(8);
                if (r == 0) {
                    (void)sac;
                    (void)sic;
                    (void)srd;
                }
            }
        }

        if (fspecHasItemCat062(fspec, 8)) {
            int32_t raw_lat = br.readS32(32);
            tp.latitude = static_cast<double>(raw_lat) * 180.0 / 2147483648.0;
            has_wgs_lat = true;
        }

        if (fspecHasItemCat062(fspec, 9)) {
            int32_t raw_lon = br.readS32(32);
            tp.longitude = static_cast<double>(raw_lon) * 180.0 / 2147483648.0;
            has_wgs_lon = true;
        }

        if (has_wgs_lat && has_wgs_lon) {
            tp.has_position = true;
        }

        if (fspecHasItemCat062(fspec, 10)) {
            int32_t dx = br.readS32(32);
            (void)dx;
        }

        if (fspecHasItemCat062(fspec, 11)) {
            int32_t dy = br.readS32(32);
            (void)dy;
        }

        if (fspecHasItemCat062(fspec, 12)) {
            uint16_t alt_raw = br.readU16(16);
            tp.altitude_fl = static_cast<double>(alt_raw) * 6.25 / 100.0;
            tp.has_altitude = true;
        }

        if (fspecHasItemCat062(fspec, 13)) {
            uint32_t raw_code = br.readU32(16);
            uint8_t a4 = (raw_code >> 12) & 0x07;
            uint8_t a3 = (raw_code >> 8) & 0x07;
            uint8_t a2 = (raw_code >> 4) & 0x07;
            uint8_t a1 = raw_code & 0x07;
            (void)(a1 * 1000 + a2 * 100 + a3 * 10 + a4);
        }

        if (fspecHasItemCat062(fspec, 14)) {
            uint16_t gs_raw = br.readU16(16);
            tp.ground_speed = static_cast<double>(gs_raw) * 360.0 / 65536.0;
        }

        if (fspecHasItemCat062(fspec, 15)) {
            uint16_t heading = br.readU16(16);
            tp.track_angle = static_cast<double>(heading) * 360.0 / 65536.0;
        }

        if (fspecHasItemCat062(fspec, 16)) {
            int32_t vx = br.readS32(32);
            (void)vx;
        }

        if (fspecHasItemCat062(fspec, 17)) {
            int32_t vy = br.readS32(32);
            (void)vy;
        }

        if (fspecHasItemCat062(fspec, 18)) {
            int16_t climb_rate = static_cast<int16_t>(br.readU16(16));
            (void)climb_rate;
        }

        if (fspecHasItemCat062(fspec, 19)) {
            uint8_t type = br.readU8(8);
        }

        if (fspecHasItemCat062(fspec, 20)) {
            uint8_t c1 = br.readU8(6);
            uint8_t c2 = br.readU8(6);
            uint8_t c3 = br.readU8(6);
            uint8_t c4 = br.readU8(6);
            uint8_t c5 = br.readU8(6);
            uint8_t c6 = br.readU8(6);
            uint8_t c7 = br.readU8(6);
            uint8_t c8 = br.readU8(6);
            char cs[9] = {0};
            uint8_t arr[8] = {c1, c2, c3, c4, c5, c6, c7, c8};
            for (int i = 0; i < 8; i++) {
                if (arr[i] == 32) cs[i] = ' ';
                else if (arr[i] >= 1 && arr[i] <= 26) cs[i] = 'A' + arr[i] - 1;
                else if (arr[i] >= 48 && arr[i] <= 57) cs[i] = '0' + (arr[i] - 48);
                else cs[i] = ' ';
            }
            tp.callsign = std::string(cs);
        }

        if (fspecHasItemCat062(fspec, 21)) {
            uint8_t cat = br.readU8(8);
        }

        if (fspecHasItemCat062(fspec, 22)) {
            uint8_t id1 = br.readU8(8);
            uint8_t id2 = br.readU8(8);
            uint8_t id3 = br.readU8(8);
            uint8_t id4 = br.readU8(8);
            uint8_t id5 = br.readU8(8);
            uint8_t id6 = br.readU8(8);
            uint8_t id7 = br.readU8(8);
            uint8_t id8 = br.readU8(8);
            char ai[9] = {0};
            uint8_t aarr[8] = {id1, id2, id3, id4, id5, id6, id7, id8};
            for (int i = 0; i < 8; i++) {
                if (aarr[i] == 32) ai[i] = ' ';
                else if (aarr[i] >= 1 && aarr[i] <= 26) ai[i] = 'A' + aarr[i] - 1;
                else if (aarr[i] >= 48 && aarr[i] <= 57) ai[i] = '0' + (aarr[i] - 48);
                else ai[i] = ' ';
            }
            if (tp.callsign.empty()) tp.callsign = std::string(ai);
        }

        if (fspecHasItemCat062(fspec, 23)) {
            uint8_t mc = br.readU8(8);
        }

        if (fspecHasItemCat062(fspec, 24)) {
            br.skipBits(8);
        }

        if (fspecHasItemCat062(fspec, 25)) {
            uint8_t v1 = br.readU8(8);
            uint8_t v2 = br.readU8(8);
        }

        if (fspecHasItemCat062(fspec, 26)) {
            br.skipBits(16);
        }

        if (fspecHasItemCat062(fspec, 27)) {
            br.skipBits(8);
        }

        if (fspecHasItemCat062(fspec, 28)) {
            br.skipBits(8);
        }

        if (fspecHasItemCat062(fspec, 29)) {
            br.skipBits(32);
        }

        if (fspecHasItemCat062(fspec, 30)) {
            uint32_t ts = br.readU32(32);
            (void)ts;
        }

        br.alignToByte();

        if (tp.has_position || tp.has_mode_s) {
            result.push_back(tp);
        }

        if (br.bytePos() >= len - 2) break;
    }

    return result;
}

}
