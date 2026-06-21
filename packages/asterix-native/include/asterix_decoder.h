#pragma once

#include <napi.h>
#include <cstdint>
#include <vector>
#include <string>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace asterix {

struct TrackPoint {
    double latitude;
    double longitude;
    double altitude_fl;
    uint32_t mode_s_address;
    uint32_t track_number;
    double time_of_day;
    bool has_mode_s;
    bool has_position;
    bool has_altitude;
    double ground_speed;
    double track_angle;
    std::string callsign;
};

struct RadarSource {
    double radar_lat;
    double radar_lon;
    uint16_t sac;
    uint16_t sic;
};

class BitReader {
public:
    BitReader(const uint8_t* data, size_t len);
    uint64_t readBits(size_t n);
    uint32_t readU32(size_t n);
    int32_t readS32(size_t n);
    uint16_t readU16(size_t n);
    uint8_t readU8(size_t n);
    bool readBit();
    void skipBits(size_t n);
    size_t bitPos() const { return bit_pos_; }
    size_t bytePos() const { return byte_pos_; }
    bool eof() const { return byte_pos_ >= length_; }
    void alignToByte();

private:
    const uint8_t* data_;
    size_t length_;
    size_t byte_pos_;
    size_t bit_pos_;
};

std::vector<TrackPoint> decodeCat048(const uint8_t* data, size_t len, const RadarSource& radar);
std::vector<TrackPoint> decodeCat062(const uint8_t* data, size_t len);

double wgs84DistanceBearingToLat(double lat, double lon, double range_m, double bearing_deg, double& out_lat, double& out_lon);

}
