import json
import random
import faker

# Initialize Faker
fake = faker.Faker("en_IN")

# Predefined list of unique names
unique_names_list = [
    "Aarav Sharma", "Vivaan Gupta", "Ananya Iyer", "Diya Kapoor", "Ishaan Reddy",
    "Aditi Verma", "Kavya Nair", "Arjun Patel", "Riya Sen", "Aditya Mehta",
    "Meera Singh", "Aryan Malhotra", "Priya Joshi", "Siddharth Rao", "Tanya Das",
    "Nisha Jain", "Rajesh Kumar", "Sneha Agarwal", "Rahul Thakur", "Pooja Chawla",
    "Akash Khanna", "Simran Bhatia", "Vikas Mishra", "Neha Roy", "Manish Sahu",
    "Sangeeta Chatterjee", "Kunal Desai", "Harsha Venkatesh", "Rohan Banerjee", "Sonali Dutta"
]

# Function to generate a random Aadhar number
def generate_aadhar():
    return str(random.randint(1000_0000_0000, 9999_9999_9999))

# Generate the data
data = []
phone_number = "+918826417060"
used_names = set()

while len(data) < 100:
    name = random.choice(unique_names_list)
    if name in used_names:
        continue  # Skip if the name is already used

    used_names.add(name)
    gender = "Male" if "Aarav" in name or "Arjun" in name or "Aditya" in name else "Female"
    dob = fake.date_of_birth(minimum_age=18, maximum_age=100).strftime("%Y-%m-%d")
    aadhar_number = generate_aadhar()

    data.append({
        "AadharNumber": aadhar_number,
        "Name": name,
        "Gender": gender,
        "DateOfBirth": dob,
        "PhoneNumber": phone_number
    })

# Save the data to a JSON file
with open("aadhar_data.json", "w") as json_file:
    json.dump(data, json_file, indent=4)

print("Generated 100 rows and saved to 'aadhar_data.json'")
